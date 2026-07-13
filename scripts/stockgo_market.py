"""Build StockGO's decision-oriented daily market snapshot.

The public snapshot combines the formal research database with official
intraday reference quotes.  It publishes research watchlists and risk overlays,
never orders or claims of a production-ready trading model.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import math
import sqlite3
import time
import urllib.parse
import urllib.request
from contextlib import closing
from pathlib import Path
from typing import Any, Callable


TAIPEI = dt.timezone(dt.timedelta(hours=8), name="Asia/Taipei")
TWSE_MIS = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
TWSE_TRADING = "https://www.twse.com.tw/zh/products/system/trading.html"
TWSE_INFORMATION = "https://www.twse.com.tw/zh/products/information/information.html"
INDEX_CHANNELS = "tse_t00.tw|otc_o00.tw"
PULLBACK_STRATEGY_ID = "core_revenue"
PULLBACK_STRATEGY_VERSION = 5
AI_STRATEGIES = (
    ("database", "ai_db_challenger", 2, "AI 資料庫組"),
    ("web", "ai_web_challenger", 2, "AI 純網路組"),
)
MAX_ENTRY_RETURN_20D = 0.20
MAX_ENTRY_DISTANCE_MA20 = 0.10
MAX_ENTRY_INTRADAY_CHANGE = 0.07
MACRO_LABELS = {
    "SOX": "費城半導體指數",
    "IXIC": "NASDAQ 綜合指數",
    "TSM": "台積電 ADR",
}


def _now_taipei(now: dt.datetime | None = None) -> dt.datetime:
    if now is None:
        return dt.datetime.now(TAIPEI)
    if now.tzinfo is None:
        return now.replace(tzinfo=TAIPEI)
    return now.astimezone(TAIPEI)


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma query_only=on")
    return conn


def _latest_card(reports: Path) -> dict[str, Any]:
    candidates = sorted(reports.glob("????-??-??_card.json"), reverse=True)
    for path in candidates:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload.get("market"), dict):
                return payload
        except (OSError, json.JSONDecodeError):
            continue
    return {}


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _exposure_experiment(reports: Path) -> dict[str, Any]:
    """Read only the aggregate exposure fields approved for the public page."""
    payload = _read_json(reports / "exposure" / "exposure_strategy_public.json")
    empty = {
        "status": "not_registered",
        "protocol_registered": False,
        "prospective": False,
        "paper_only": True,
        "no_backfill": True,
        "historical_gate_status": "not_run",
        "inception_date": None,
        "as_of_session": None,
        "coverage_complete": False,
        "coverage_note": "尚無歷史估值",
        "official_sessions": 0,
        "common_complete_sessions": 0,
        "sample_sessions": 0,
        "message": "曝險實驗尚未產生可公開結果。",
        "arms": [],
    }
    if not payload:
        return empty

    def safe_date(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        try:
            return dt.date.fromisoformat(value).isoformat()
        except ValueError:
            return None

    def safe_number(value: object, *, minimum: float | None = None,
                    maximum: float | None = None) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        result = float(value)
        if not math.isfinite(result):
            return None
        if minimum is not None and result < minimum:
            return None
        if maximum is not None and result > maximum:
            return None
        return result

    def safe_reason(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        result = " ".join(value.split()).strip()
        lowered = result.lower()
        forbidden = ("protocol_hash", "source_db", "ledger", ".sqlite", "file:", "\\")
        if not result or len(result) > 120 or any(token in lowered for token in forbidden):
            return None
        return result

    allowed_statuses = {
        "not_registered", "registered_awaiting_historical", "historical_pass_tracking_allowed",
        "historical_terminal_no_prospective", "invalid",
    }
    allowed_gates = {
        "not_run", "historical_pass", "historical_fail", "insufficient_history", "invalid_data",
    }
    contract_invalid = False
    status = payload.get("status") if payload.get("status") in allowed_statuses else "invalid"
    contract_invalid = contract_invalid or payload.get("status") not in allowed_statuses
    gate = (
        payload.get("historical_gate_status")
        if payload.get("historical_gate_status") in allowed_gates else "invalid_data"
    )
    contract_invalid = contract_invalid or payload.get("historical_gate_status") not in allowed_gates
    contract_invalid = contract_invalid or payload.get("paper_only") is not True
    contract_invalid = contract_invalid or payload.get("no_backfill") is not True
    contract_invalid = contract_invalid or not isinstance(payload.get("protocol_registered"), bool)
    contract_invalid = contract_invalid or not isinstance(payload.get("prospective"), bool)
    registered = payload.get("protocol_registered") is True
    requested_prospective = payload.get("prospective") is True
    official_sessions = payload.get("official_sessions")
    common_sessions = payload.get("common_complete_sessions")
    valid_official_sessions = bool(
        isinstance(official_sessions, int)
        and not isinstance(official_sessions, bool) and official_sessions >= 0
    )
    official_sessions = official_sessions if valid_official_sessions else 0
    valid_common_sessions = bool(
        isinstance(common_sessions, int)
        and not isinstance(common_sessions, bool) and 0 <= common_sessions <= official_sessions
    )
    common_sessions = common_sessions if valid_common_sessions else 0
    contract_invalid = contract_invalid or not valid_official_sessions or not valid_common_sessions
    coverage_complete = bool(official_sessions and common_sessions == official_sessions)
    coverage_note = (
        f"{common_sessions:,}/{official_sessions:,} 個官方交易日有同日估值"
        if official_sessions else "尚無歷史估值"
    )
    if official_sessions and common_sessions < official_sessions:
        coverage_note += f"；缺少 {official_sessions - common_sessions:,} 日，未沿用舊價"
    messages = {
        "historical_pass": "歷史閘門通過，但仍只是紙上結果；必須累積前瞻樣本後才能重新判讀。",
        "historical_fail": "20年歷史閘門未通過：降低回撤仍不足以彌補長期報酬落後，因此停止、不調參。",
        "insufficient_history": "歷史資料不足，不能宣稱具有優勢，也不建立前瞻排程。",
        "invalid_data": "公開資料驗證或歷史資料完整性未通過；結果停止使用。",
        "not_run": "規則尚未完成一次性歷史閘門。",
    }
    arm_specs = {
        "tactical_0050": ("0050＋現金（200日線）", "0050"),
        "buyhold_0050": ("0050 長期持有", "0050"),
        "tactical_2330": ("2330 挑戰組（同一訊號）", "2330"),
        "buyhold_2330": ("2330 長期持有", "2330"),
    }
    arms_payload = payload.get("arms")
    if not isinstance(arms_payload, list) or len(arms_payload) > len(arm_specs):
        contract_invalid = True
        arms_payload = []
    arms = []
    seen_arms: set[str] = set()
    for row in arms_payload:
        if not isinstance(row, dict) or row.get("arm_id") not in arm_specs:
            contract_invalid = True
            continue
        arm_id = str(row["arm_id"])
        if arm_id in seen_arms:
            contract_invalid = True
            continue
        seen_arms.add(arm_id)
        label, asset_code = arm_specs[arm_id]
        reasons_payload = row.get("reason_labels")
        if not isinstance(reasons_payload, list) or len(reasons_payload) > 3:
            contract_invalid = True
            reasons_payload = []
        reasons = []
        for value in reasons_payload:
            reason = safe_reason(value)
            if reason is None:
                contract_invalid = True
            else:
                reasons.append(reason)
        trade_count = row.get("trade_count")
        valid_trade_count = bool(
            isinstance(trade_count, int)
            and not isinstance(trade_count, bool) and trade_count >= 0
        )
        trade_count = trade_count if valid_trade_count else 0
        contract_invalid = contract_invalid or not valid_trade_count
        sanitized_row = {
            "arm_id": arm_id,
            "label": label,
            "asset_code": asset_code,
            "current_exposure": safe_number(row.get("current_exposure"), minimum=0, maximum=1),
            "next_target_exposure": safe_number(row.get("next_target_exposure"), minimum=0, maximum=1),
            "next_effective_session": safe_date(row.get("next_effective_session")),
            "action_label": "可進入紙上前瞻追蹤" if gate == "historical_pass" else "歷史閘門未通過",
            "reason_labels": reasons,
            "cumulative_net_return": safe_number(row.get("cumulative_net_return"), minimum=-1),
            "buy_hold_return": safe_number(row.get("buy_hold_return"), minimum=-1),
            "excess_vs_own_buy_hold": safe_number(row.get("excess_vs_own_buy_hold")),
            "excess_vs_0050_buy_hold": safe_number(row.get("excess_vs_0050_buy_hold")),
            "current_drawdown": safe_number(row.get("current_drawdown"), minimum=0, maximum=1),
            "max_drawdown": safe_number(row.get("max_drawdown"), minimum=0, maximum=1),
            "trade_count": trade_count,
            "transaction_cost_drag": safe_number(row.get("transaction_cost_drag"), minimum=0),
        }
        required_metrics = (
            "cumulative_net_return", "buy_hold_return", "max_drawdown",
            "transaction_cost_drag",
        )
        contract_invalid = contract_invalid or any(
            sanitized_row[key] is None for key in required_metrics
        )
        arms.append(sanitized_row)
    sample_sessions = payload.get("sample_sessions")
    sample_sessions = (
        sample_sessions if isinstance(sample_sessions, int)
        and not isinstance(sample_sessions, bool) and sample_sessions >= 0 else 0
    )
    contract_invalid = contract_invalid or not (
        isinstance(payload.get("sample_sessions"), int)
        and not isinstance(payload.get("sample_sessions"), bool)
        and payload.get("sample_sessions") >= 0
    )
    expected_arms = set(arm_specs)
    if gate in {"historical_pass", "historical_fail"} and seen_arms != expected_arms:
        contract_invalid = True
    if gate == "historical_pass" and not (
        registered and status == "historical_pass_tracking_allowed" and requested_prospective
    ):
        contract_invalid = True
    if gate in {"historical_fail", "insufficient_history"} and not (
        registered and status == "historical_terminal_no_prospective" and not requested_prospective
    ):
        contract_invalid = True
    if gate == "not_run" and not (
        status in {"not_registered", "registered_awaiting_historical"}
        and not requested_prospective and not arms
    ):
        contract_invalid = True
    if gate == "invalid_data" and requested_prospective:
        contract_invalid = True
    if contract_invalid:
        status = "invalid"
        gate = "invalid_data"
        arms = []
    prospective = bool(
        not contract_invalid and gate == "historical_pass"
        and status == "historical_pass_tracking_allowed" and requested_prospective
    )
    public = {
        "status": status,
        "protocol_registered": registered,
        "prospective": prospective,
        "paper_only": True,
        "no_backfill": True,
        "historical_gate_status": gate,
        "inception_date": safe_date(payload.get("inception_date")),
        "as_of_session": safe_date(payload.get("as_of_session")),
        "coverage_complete": coverage_complete,
        "coverage_note": coverage_note,
        "official_sessions": official_sessions,
        "common_complete_sessions": common_sessions,
        "sample_sessions": sample_sessions,
        "message": messages[gate],
        "arms": arms,
    }
    return public


def _public_paper_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        features = json.loads(row["features"] or "{}")
    except (TypeError, json.JSONDecodeError):
        features = {}
    display_name = (
        row["display_name"]
        if "display_name" in row.keys() and row["display_name"]
        else row["name"]
    )
    return {
        "code": str(row["code"]),
        "name": str(display_name or row["code"]),
        "strategy_id": str(row["strategy_id"]),
        "strategy_version": int(row["strategy_version"]),
        "signal_rank": int(features.get("signal_rank") or features.get("rank") or 0),
        "signal_date": row["signal_date"],
        "run_at": row["run_at"],
        "horizon_days": int(row["horizon_days"]),
        "signal_close": row["signal_close"],
        "entry_method": row["entry_method"],
        "entry_date": row["entry_date"],
        "entry_price": row["entry_price"],
        "latest_price": row["latest_price"] if "latest_price" in row.keys() else None,
        "latest_price_date": row["latest_price_date"] if "latest_price_date" in row.keys() else None,
        "exit_date": row["exit_date"],
        "exit_price": row["exit_price"],
        "net_return": row["net_ret"],
        "benchmark_return": row["benchmark_ret"],
        "alpha_return": row["alpha_ret"],
        "direction_hit": row["direction_hit"],
        "settlement_status": row["settlement_status"],
        "features": {
            key: features.get(key)
            for key in (
                "alpha20", "ret20", "dist_ma20", "atr_pct",
                "volume_ratio", "revenue_yoy", "signal_rank", "rank",
                "arm", "confidence", "thesis", "risk", "source_urls",
            )
            if key in features
        },
    }


def _paper_experiment(paper_db: Path | None, paper_reports: Path | None) -> dict[str, Any]:
    readiness = _read_json((paper_reports or Path("__missing__")) / "trade_readiness.json")
    empty = {
        "strategy_id": PULLBACK_STRATEGY_ID,
        "strategy_version": PULLBACK_STRATEGY_VERSION,
        "control_version": 4,
        "status": "database_unavailable",
        "protocol_registered": False,
        "latest_signal_date": None,
        "latest_market_date": None,
        "latest_paper_run_date": None,
        "latest_signals": [],
        "awaiting_entry": [],
        "open_trials": [],
        "settled_results": [],
        "scoreboard": [],
        "ai_groups": [],
        "completed_trials": int(
            ((readiness.get("tradability") or {}).get("research_governance") or {}).get("completed_trials") or 0
        ),
        "broker_sim_sessions": int(
            ((readiness.get("tradability") or {}).get("broker_sim") or {}).get("eligible_market_sessions") or 0
        ),
        "live_enabled": False,
        "no_backfill": True,
        "message": "P2 前瞻帳本尚不可用。",
    }
    if paper_db is None or not paper_db.exists():
        return empty

    with closing(_connect(paper_db)) as conn:
        if not _table_exists(conn, "strategy_protocol") or not _table_exists(conn, "strategy_paper_log"):
            return {**empty, "status": "schema_unavailable", "message": "P2 尚未建立前瞻實驗資料表。"}
        protocol = conn.execute(
            "select protocol_json,registered_at from strategy_protocol "
            "where strategy_id=? and strategy_version=?",
            (PULLBACK_STRATEGY_ID, PULLBACK_STRATEGY_VERSION),
        ).fetchone()
        if not protocol:
            return {**empty, "status": "not_registered", "message": "v5 強勢拉回規格尚未註冊。"}

        has_prices = _table_exists(conn, "prices")
        latest_price_sql = (
            ",(select p.close from prices p where p.code=s.code "
            "order by p.date desc limit 1) latest_price"
            ",(select p.date from prices p where p.code=s.code "
            "order by p.date desc limit 1) latest_price_date"
            if has_prices else ",null latest_price,null latest_price_date"
        )
        primary_rows = conn.execute(
            f"select s.*{latest_price_sql} from strategy_paper_log s "
            "where strategy_id=? and strategy_version=? "
            "and horizon_days=20 order by signal_date desc,code",
            (PULLBACK_STRATEGY_ID, PULLBACK_STRATEGY_VERSION),
        ).fetchall()
        result_rows = conn.execute(
            "select * from strategy_paper_log where strategy_id=? and strategy_version=? "
            "and settlement_status='settled' order by exit_date desc,signal_date desc,horizon_days,code limit 40",
            (PULLBACK_STRATEGY_ID, PULLBACK_STRATEGY_VERSION),
        ).fetchall()
        score_rows = conn.execute(
            "select horizon_days,count(*) n,avg(direction_hit) hit_rate,"
            "avg(case when alpha_ret>0 then 1.0 else 0.0 end) beat_rate,avg(net_ret) avg_return,"
            "avg(alpha_ret) avg_alpha from strategy_paper_log where strategy_id=? and strategy_version=? "
            "and settlement_status='settled' group by horizon_days order by horizon_days",
            (PULLBACK_STRATEGY_ID, PULLBACK_STRATEGY_VERSION),
        ).fetchall()
        ai_groups = []
        for arm, strategy_id, version, label in AI_STRATEGIES:
            ai_protocol = conn.execute(
                "select registered_at from strategy_protocol "
                "where strategy_id=? and strategy_version=?",
                (strategy_id, version),
            ).fetchone()
            display_name_sql = (
                "coalesce((select p.name from prices p where p.code=s.code "
                "and p.date<=s.signal_date order by p.date desc limit 1),s.name)"
                if has_prices
                else "s.name"
            )
            ai_rows = conn.execute(
                f"select s.*,{display_name_sql} display_name{latest_price_sql} "
                "from strategy_paper_log s where strategy_id=? "
                "and strategy_version=? and horizon_days=20 "
                "order by signal_date desc,code",
                (strategy_id, version),
            ).fetchall()
            ai_scores = conn.execute(
                "select horizon_days,count(*) n,avg(direction_hit) hit_rate,"
                "avg(case when alpha_ret>0 then 1.0 else 0.0 end) beat_rate,"
                "avg(net_ret) avg_return,avg(alpha_ret) avg_alpha "
                "from strategy_paper_log where strategy_id=? and strategy_version=? "
                "and settlement_status='settled' group by horizon_days order by horizon_days",
                (strategy_id, version),
            ).fetchall()
            run_counts = {"success": 0, "no_run": 0}
            run_dates: set[str] = set()
            latest_run = None
            if _table_exists(conn, "ai_challenger_run"):
                for run_row in conn.execute(
                        "select status,count(*) n from ai_challenger_run "
                        "where arm=? group by status", (arm,)):
                    run_counts[str(run_row["status"])] = int(run_row["n"])
                run_dates = {
                    str(row["signal_date"])
                    for row in conn.execute(
                        "select signal_date from ai_challenger_run where arm=?", (arm,))
                }
                latest_row = conn.execute(
                    "select signal_date,run_at,status,model_id,no_run_reason "
                    "from ai_challenger_run where arm=? order by run_at desc limit 1",
                    (arm,),
                ).fetchone()
                latest_run = dict(latest_row) if latest_row else None
            registered_date = (
                str(ai_protocol["registered_at"])[:10] if ai_protocol else None)
            benchmark_dates = []
            if registered_date:
                benchmark_dates = [
                    str(row["date"]) for row in conn.execute(
                        "select distinct date from prices where code=? and date>=? order by date",
                        ("0050", registered_date),
                    )
                ]
            missing_run_dates = [
                date for date in benchmark_dates if date not in run_dates]
            public_rows = [_public_paper_row(row) for row in ai_rows]
            latest_date = max((row["signal_date"] for row in public_rows), default=None)
            latest_picks = [
                row for row in public_rows if row["signal_date"] == latest_date]
            latest_picks.sort(
                key=lambda row: (row["signal_rank"] or 999, row["code"]))
            tracking_date = max((
                row["signal_date"] for row in public_rows
                if row["settlement_status"] == "pending" and row["entry_date"]
            ), default=None)
            tracking_picks = [
                row for row in public_rows
                if row["signal_date"] == tracking_date
                and row["settlement_status"] == "pending"
                and row["entry_date"]
            ]
            tracking_picks.sort(
                key=lambda row: (row["signal_rank"] or 999, row["code"]))
            awaiting_latest_entry = [row for row in latest_picks if not row["entry_date"]]
            ai_groups.append({
                "arm": arm,
                "label": label,
                "strategy_id": strategy_id,
                "strategy_version": version,
                "protocol_registered": ai_protocol is not None,
                "protocol_registered_at": ai_protocol["registered_at"] if ai_protocol else None,
                "successful_signal_days": run_counts["success"],
                "no_run_days": run_counts["no_run"],
                "missing_run_signal_dates": missing_run_dates,
                "schedule_coverage_complete": not missing_run_dates,
                "latest_run": latest_run,
                "latest_signal_date": latest_date,
                "latest_picks": latest_picks,
                "tracking_signal_date": tracking_date,
                "tracking_picks": tracking_picks,
                "awaiting_latest_entry": awaiting_latest_entry,
                "scoreboard": [{
                    "horizon_days": int(row["horizon_days"]),
                    "observations": int(row["n"]),
                    "hit_rate": row["hit_rate"],
                    "beat_rate": row["beat_rate"],
                    "average_return": row["avg_return"],
                    "average_alpha": row["avg_alpha"],
                } for row in ai_scores],
            })
        latest_market_date = None
        if has_prices:
            latest_market_row = conn.execute(
                "select max(date) date from prices where code=?", ("0050",)
            ).fetchone()
            latest_market_date = latest_market_row["date"] if latest_market_row else None
        latest_paper_run_date = None
        if _table_exists(conn, "paper_run_log"):
            latest_run_row = conn.execute(
                "select price_date_after from paper_run_log where status='success' "
                "order by finished_at desc limit 1"
            ).fetchone()
            latest_paper_run_date = latest_run_row["price_date_after"] if latest_run_row else None

    primary = [_public_paper_row(row) for row in primary_rows]
    latest_signal_date = max((row["signal_date"] for row in primary), default=None)
    latest_signals = [row for row in primary if row["signal_date"] == latest_signal_date]
    latest_signals.sort(key=lambda row: (row["signal_rank"] or 999, row["code"]))
    awaiting_entry = [
        row for row in primary
        if row["settlement_status"] == "pending" and not row["entry_date"]
    ]
    open_trials = [
        row for row in primary
        if row["settlement_status"] == "pending" and row["entry_date"]
    ]
    settled_results = [_public_paper_row(row) for row in result_rows]
    scoreboard = [
        {
            "horizon_days": int(row["horizon_days"]),
            "observations": int(row["n"]),
            "hit_rate": row["hit_rate"],
            "beat_rate": row["beat_rate"],
            "average_return": row["avg_return"],
            "average_alpha": row["avg_alpha"],
        }
        for row in score_rows
    ]
    if (latest_market_date and latest_paper_run_date == latest_market_date
            and latest_signal_date != latest_market_date):
        status = "no_eligible"
        message = f"{latest_market_date} 沒有股票通過 v5 買進門檻；既有前瞻批次仍照規則追蹤。"
    elif latest_signals and any(not row["entry_date"] for row in latest_signals):
        status = "pending_next_open"
        message = "v5 新訊號已凍結；等待下一個交易日開盤作為模擬買入價。"
    elif primary:
        status = "collecting"
        message = "v5 已開始不可回填的前瞻追蹤。"
    else:
        status = "waiting_first_signal"
        message = "v5 已註冊；等待下一個收盤後的新市場日產生第一批訊號。"
    return {
        **empty,
        "status": status,
        "protocol_registered": True,
        "protocol_registered_at": protocol["registered_at"],
        "latest_signal_date": latest_signal_date,
        "latest_market_date": latest_market_date,
        "latest_paper_run_date": latest_paper_run_date,
        "latest_signals": latest_signals,
        "awaiting_entry": awaiting_entry,
        "open_trials": open_trials,
        "settled_results": settled_results,
        "scoreboard": scoreboard,
        "ai_groups": ai_groups,
        "message": message,
    }


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "select 1 from sqlite_master where type='table' and name=?", (name,)
    ).fetchone() is not None


def _candidate_factors(row: dict[str, Any]) -> tuple[list[str], list[str]]:
    factors = []
    if int(row.get("core_score") or 0) >= 3:
        factors.append("趨勢三項通過")
    if float(row.get("alpha20") or 0.0) > 0:
        factors.append("相對0050強（非進場訊號）")
    if int(row.get("revenue_score") or 0) >= 3 and float(row.get("revenue_yoy") or 0.0) > 0:
        factors.append("營收條件通過")
    if (
        float(row.get("foreign5_ratio") or 0.0) > 0
        or int(row.get("foreign_buy_streak") or 0) >= 2
    ):
        factors.append("法人資金順風")
    if int(row.get("quality_score") or 0) >= 5:
        factors.append("財報品質較佳")

    risks = []
    if float(row.get("dist_ma20") or 0.0) >= 0.20:
        risks.append("距月線過遠")
    if float(row.get("atr_pct") or 0.0) >= 0.07:
        risks.append("日常波動偏高")
    if (
        float(row.get("foreign5_ratio") or 0.0) <= -0.20
        or int(row.get("foreign_sell_streak") or 0) >= 3
    ):
        risks.append("法人資金逆風")
    if row.get("quality_score") is not None and int(row.get("quality_score") or 0) < 3:
        risks.append("財報品質分數偏低")
    return factors, risks


def _rule_summary(rule: dict[str, Any]) -> dict[str, Any]:
    period = (rule.get("periods") or {}).get("last5") or (rule.get("periods") or {}).get("all") or {}
    return {
        "key": str(rule.get("key") or ""),
        "label": str(rule.get("label") or "未命名規則"),
        "use": str(rule.get("use") or ""),
        "horizon_days": int(rule.get("horizon_days") or 0),
        "status": str(rule.get("status") or "研究中"),
        "sample_size": int(period.get("n") or 0),
        "up_rate": float(period.get("up_rate") or 0.0),
        "average_return": float(period.get("avg_return") or 0.0),
        "average_alpha": float(period.get("avg_alpha") or 0.0),
        "beat_rate": float(period.get("beat_rate") or 0.0),
        "start_date": period.get("start_date"),
        "end_date": period.get("end_date"),
    }


def _risk_observation(reports: Path) -> dict[str, Any]:
    """Return only public, non-actionable fields from the isolated ledger report."""
    raw = _read_json(reports / "risk_observation.json")
    latest = raw.get("latest") if isinstance(raw.get("latest"), dict) else None
    public_latest = None
    if latest:
        inputs = latest.get("inputs") if isinstance(latest.get("inputs"), dict) else {}
        public_latest = {
            "target_date": latest.get("target_date"),
            "asof_date": latest.get("asof_date"),
            "frozen_at": latest.get("frozen_at"),
            "status": latest.get("status"),
            "warning_level": latest.get("warning_level"),
            "risk_points": latest.get("risk_points"),
            "prospective": bool(latest.get("prospective")),
            "missing_inputs": [str(value) for value in latest.get("missing_inputs") or []],
            "inputs": {
                "breadth_score": inputs.get("breadth_score"),
                "fraction_above_ma20": inputs.get("fraction_above_ma20"),
                "overnight_composite": inputs.get("overnight_composite"),
                "realized_volatility_20d": inputs.get("realized_volatility_20d"),
            },
        }
    return {
        "status": str(raw.get("status") or "not_started"),
        "purpose": "learning_warning_only",
        "prospective_start_date": str(raw.get("prospective_start_date") or "2026-07-20"),
        "observations": int(raw.get("observations") or 0),
        "latest": public_latest,
        "disclosure": str(raw.get("disclosure") or (
            "2026-07-17 was not predicted by this prospective layer; "
            "collection starts on 2026-07-20."
        )),
        "changes_stock_selection": False,
        "live_trading": False,
    }


def build_context(
    formal_db: Path,
    reports: Path,
    calendar_path: Path,
    *,
    benchmark: str,
    now: dt.datetime | None = None,
    paper_db: Path | None = None,
    paper_reports: Path | None = None,
) -> dict[str, Any]:
    """Read research evidence and bounded watchlists from the formal database."""
    now = _now_taipei(now)
    card = _latest_card(reports)
    research = _read_json(reports / "research.json")
    research_audit = research.get("audit") or {}
    trade_readiness = _read_json((paper_reports or reports) / "trade_readiness.json")
    experiment = _paper_experiment(paper_db, paper_reports)
    exposure_experiment = _exposure_experiment(reports)
    risk_observation = _risk_observation(reports)
    card_market = card.get("market") or {}
    breadth = card_market.get("breadth") or {}
    sectors = card_market.get("sector_strength") or []
    raw_candidates = list(experiment.get("latest_signals") or [])[:5]
    raw_avoids = list(card.get("avoids") or [])[:10]
    ai_public_rows = [
        row
        for group in experiment.get("ai_groups") or []
        for key in ("latest_picks", "tracking_picks")
        for row in group.get(key) or []
    ]
    public_codes = sorted({
        str(row.get("code") or "")
        for row in [*raw_candidates, *raw_avoids, *ai_public_rows]
        if row.get("code")
    })

    with closing(_connect(formal_db)) as conn:
        benchmark_rows = conn.execute(
            "select date,close from prices where code=? order by date desc limit 2",
            (benchmark,),
        ).fetchall()
        macro_rows = conn.execute(
            """
            select m.symbol,m.date,m.ret
            from macro m
            join (select symbol,max(date) date from macro group by symbol) latest
              on latest.symbol=m.symbol and latest.date=m.date
            where m.symbol in ('SOX','IXIC','TSM')
            order by m.symbol
            """
        ).fetchall()
        info_by_code: dict[str, dict[str, Any]] = {}
        feature_by_code: dict[str, dict[str, Any]] = {}
        if public_codes and _table_exists(conn, "stock_info"):
            placeholders = ",".join("?" for _ in public_codes)
            for row in conn.execute(
                f"select code,name,industry,market from stock_info where code in ({placeholders})",
                public_codes,
            ):
                info_by_code[str(row["code"])] = dict(row)
        if public_codes and _table_exists(conn, "feature_store"):
            placeholders = ",".join("?" for _ in public_codes)
            query = f"""
                select f.code,f.date,f.name,f.sector,f.close,f.core_score,
                       f.ret5,f.ret20,f.ret60,f.alpha20,f.dist_ma20,f.dist_ma60,
                       f.atr_pct,f.volume_ratio,f.foreign3_ratio,f.foreign5_ratio,
                       f.revenue_yoy,f.revenue_yoy_delta,f.revenue_score,
                       f.quality_score,f.margin_delta_ratio,f.short_margin_ratio,
                       f.foreign_buy_streak,f.foreign_sell_streak,f.high52w_prox,
                       f.updown_vol_ratio
                from feature_store f
                join (
                    select code,max(date) date from feature_store
                    where code in ({placeholders}) group by code
                ) latest on latest.code=f.code and latest.date=f.date
            """
            for row in conn.execute(query, public_codes):
                feature_by_code[str(row["code"])] = dict(row)

    latest_market_date = benchmark_rows[0]["date"] if benchmark_rows else None
    benchmark_return = None
    if len(benchmark_rows) == 2 and benchmark_rows[1]["close"]:
        benchmark_return = (
            float(benchmark_rows[0]["close"]) / float(benchmark_rows[1]["close"]) - 1.0
        )

    closed_dates: list[str] = []
    try:
        calendar = json.loads(calendar_path.read_text(encoding="utf-8"))
        closed_dates = [str(value) for value in calendar.get("closed_dates", [])]
    except (OSError, json.JSONDecodeError):
        pass

    beat_market_rate = next((
        float(value or 0.0)
        for key, value in breadth.items()
        if key.startswith("beat_") and key.endswith("_rate")
    ), 0.0)
    safe_sectors = []
    for row in sectors[:10]:
        safe_sectors.append({
            "name": str(row.get("label") or row.get("sector") or "未分類"),
            "sample_size": int(row.get("n") or 0),
            "return_20d": float(row.get("avg_ret20") or 0.0),
            "relative_20d": float(row.get("avg_alpha20") or 0.0),
            "above_ma20": float(row.get("above_ma20") or 0.0),
            "status": str(row.get("status") or "待確認"),
        })

    def public_candidate(raw: dict[str, Any]) -> dict[str, Any]:
        code = str(raw.get("code") or "")
        feature = feature_by_code.get(code, {})
        info = info_by_code.get(code, {})
        raw_features = raw.get("features") or {}
        combined = {**feature, **raw_features, **raw}
        factors, risks = _candidate_factors(combined)
        market = str(info.get("market") or "")
        channel_market = "tse" if market == "twse" else "otc" if market == "tpex" else ""
        return {
            "code": code,
            "name": str(raw.get("name") or info.get("name") or feature.get("name") or code),
            "industry": str(info.get("industry") or feature.get("sector") or "未分類"),
            "market": market,
            "quote_channel": f"{channel_market}_{code}.tw" if channel_market else None,
            "feature_date": feature.get("date") or card.get("asof"),
            "model_close": float(feature.get("close") or raw.get("close") or 0.0),
            "core_score": int(feature.get("core_score") or raw.get("core_score") or 0),
            "return_20d": float(feature.get("ret20") or 0.0),
            "relative_20d": float(feature.get("alpha20") or raw.get("alpha20") or 0.0),
            "distance_ma20": float(feature.get("dist_ma20") or 0.0),
            "atr_pct": float(feature.get("atr_pct") or 0.0),
            "volume_ratio": float(feature.get("volume_ratio") or 0.0),
            "revenue_yoy": float(feature.get("revenue_yoy") or raw.get("revenue_yoy") or 0.0),
            "revenue_score": int(feature.get("revenue_score") or 0),
            "quality_score": feature.get("quality_score"),
            "foreign5_ratio": feature.get("foreign5_ratio"),
            "foreign_buy_streak": int(feature.get("foreign_buy_streak") or 0),
            "foreign_sell_streak": int(feature.get("foreign_sell_streak") or 0),
            "evidence_factors": factors,
            "evidence_passed": len(factors),
            "evidence_total": 5,
            "risk_flags": risks,
            "signal_rank": int(raw.get("signal_rank") or 0),
            "signal_date": raw.get("signal_date"),
            "entry_date": raw.get("entry_date"),
            "entry_price": raw.get("entry_price"),
            "settlement_status": raw.get("settlement_status"),
            "strategy_version": raw.get("strategy_version"),
        }

    candidates = [public_candidate(row) for row in raw_candidates]
    candidates.sort(key=lambda row: (row["signal_rank"] or 999, row["code"]))
    for rank, row in enumerate(candidates, 1):
        row["research_rank"] = rank

    avoids = []
    for raw in raw_avoids:
        row = public_candidate(raw)
        selection = raw.get("selection") or {}
        row.update({
            "avoid_reason": str(raw.get("reason") or "風險條件未通過"),
            "selection_score": int(selection.get("score") or 0),
            "passed_checks": int(selection.get("passed") or 0),
            "total_checks": int(selection.get("total") or 0),
            "positive_checks": [str(value) for value in selection.get("reasons") or []],
            "blockers": [str(value) for value in selection.get("blockers") or []],
            "history": str(selection.get("history") or ""),
        })
        avoids.append(row)
    avoids.sort(key=lambda row: (row["selection_score"], row["relative_20d"], row["code"]))

    for row in ai_public_rows:
        code = str(row.get("code") or "")
        info = info_by_code.get(code, {})
        market = str(info.get("market") or "")
        channel_market = "tse" if market == "twse" else "otc" if market == "tpex" else ""
        row["market"] = market
        row["quote_channel"] = f"{channel_market}_{code}.tw" if channel_market else None

    def find_rule(rows: list[dict[str, Any]], key: str, horizon: int) -> dict[str, Any] | None:
        return next((row for row in rows if row.get("key") == key and int(row.get("horizon_days") or 0) == horizon), None)

    buy_rules = list(research.get("buy_rules") or [])
    danger_rules = list(research.get("danger_rules") or [])
    selected_rules = []
    for kind, rows, key, horizon in [
        ("advantage", buy_rules, "revenue_flow", 60),
        ("avoid", danger_rules, "high_volatility", 60),
        ("avoid", danger_rules, "foreign_sell", 5),
        ("avoid", danger_rules, "break_ma20", 5),
        ("avoid", danger_rules, "overheat", 5),
    ]:
        match = find_rule(rows, key, horizon)
        if match:
            selected_rules.append({"kind": kind, **_rule_summary(match)})

    quote_channels = [
        row["quote_channel"]
        for row in [*candidates, *avoids, *ai_public_rows]
        if row.get("quote_channel")
    ]
    quote_channels = list(dict.fromkeys(quote_channels))

    return {
        "schema_version": 2,
        "generated_at": now.isoformat(timespec="seconds"),
        "timezone": "Asia/Taipei",
        "latest_completed_session": latest_market_date,
        "closed_dates": closed_dates,
        "prior_session": {
            "date": latest_market_date,
            "large_cap_proxy_return": benchmark_return,
        },
        "breadth": {
            "date": breadth.get("date") or latest_market_date,
            "sample_size": int(breadth.get("n") or 0),
            "score": int(breadth.get("score") or 0),
            "status": str(breadth.get("status") or "待確認"),
            "above_ma20": float(breadth.get("above_ma20") or 0.0),
            "above_ma60": float(breadth.get("above_ma60") or 0.0),
            "beat_market_rate": beat_market_rate,
            "average_return_20d": float(breadth.get("avg_ret20") or 0.0),
            "average_relative_20d": float(breadth.get("avg_alpha20") or 0.0),
        },
        "sectors": safe_sectors,
        "candidates": candidates,
        "avoids": avoids,
        "research_rules": selected_rules,
        "experiment": experiment,
        "exposure_experiment": exposure_experiment,
        "risk_observation": risk_observation,
        "research_state": {
            "summary": str(research.get("summary") or "研究證據尚未形成正式買進模型。"),
            "latest_feature_date": research.get("latest_feature_date") or latest_market_date,
            "data_status": (card.get("data_health") or {}).get("status") or "unknown",
            "formal_status": research_audit.get("formal_status") or "unknown",
            "audit_blockers": [str(value) for value in research_audit.get("blockers") or []],
            "trade_status": trade_readiness.get("status") or "not_ready",
            "live_enabled": bool(trade_readiness.get("live_enabled")),
            "completed_trials": int(experiment.get("completed_trials") or 0),
        },
        "quote_channels": quote_channels,
        "overnight": [
            {
                "key": row["symbol"],
                "name": MACRO_LABELS[row["symbol"]],
                "date": row["date"],
                "return": float(row["ret"] or 0.0),
            }
            for row in macro_rows
        ],
        "sources": [
            {
                "name": "StockGO 正式庫",
                "freshness": latest_market_date,
                "note": "行情、特徵、風險排除與市場結構取自正式庫。",
            },
            {
                "name": "StockGO P2 前瞻帳本",
                "freshness": experiment.get("latest_signal_date"),
                "note": "候選、隔日開盤、5/20日結算與0050對照只取自不可回填的P2固定版本紀錄。",
            },
            {
                "name": "StockGO 歷史研究",
                "freshness": research.get("generated_at"),
                "note": "顯示規則的近五年樣本、報酬、勝率與相對 0050 結果。",
            },
            {
                "name": "臺灣證券交易所市場資訊",
                "url": TWSE_INFORMATION,
                "note": "盤中指數與公開觀察名單的成交／最佳委買賣參考價，每 5 分鐘重建。",
            },
            {
                "name": "臺灣證券交易所交易制度",
                "url": TWSE_TRADING,
                "note": "一般交易撮合時間為 09:00–13:30。",
            },
        ],
        "safety": {
            "live_trading": False,
            "individual_stocks": True,
            "advice": False,
        },
    }


def fetch_indices(channels: str = INDEX_CHANNELS, timeout: float = 15.0) -> dict[str, Any]:
    query = urllib.parse.urlencode({
        "ex_ch": channels,
        "json": "1",
        "delay": "0",
        "_": str(int(time.time() * 1000)),
    })
    request = urllib.request.Request(
        f"{TWSE_MIS}?{query}",
        headers={
            "User-Agent": "Mozilla/5.0 StockGO aggregate market monitor",
            "Referer": "https://mis.twse.com.tw/stock/fibest.jsp",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _number(value: Any) -> float | None:
    text = str(value or "").replace(",", "").strip()
    if text in {"", "-", "--"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _quote_time(row: dict[str, Any]) -> str | None:
    date_text = str(row.get("d") or "")
    time_text = str(row.get("t") or row.get("%") or "")
    if len(date_text) != 8 or len(time_text) < 5:
        return None
    try:
        value = dt.datetime.strptime(
            f"{date_text} {time_text[:8]}", "%Y%m%d %H:%M:%S"
        ).replace(tzinfo=TAIPEI)
    except ValueError:
        return None
    return value.isoformat(timespec="seconds")


def parse_indices(payload: dict[str, Any]) -> list[dict[str, Any]]:
    # A mixed MIS response can contain stocks and indices for the same
    # exchange.  The exchange value alone is therefore not an index identity.
    labels = {("tse", "t00"): "加權指數", ("otc", "o00"): "櫃買指數"}
    rows = []
    seen_markets: set[str] = set()
    for raw in payload.get("msgArray") or []:
        market = str(raw.get("ex") or "").lower()
        code = str(raw.get("c") or "").lower()
        if (market, code) not in labels or market in seen_markets:
            continue
        reference = _number(raw.get("y"))
        current = _number(raw.get("z"))
        change_pct = None
        if current is not None and reference:
            change_pct = current / reference - 1.0
        rows.append({
            "market": market,
            "name": labels[(market, code)],
            "date": str(raw.get("d") or ""),
            "quote_at": _quote_time(raw),
            "reference": reference,
            "value": current,
            "change_pct": change_pct,
            "volume": _number(raw.get("v")),
        })
        seen_markets.add(market)
    return rows


def _levels(value: Any) -> list[float]:
    levels = []
    for raw in str(value or "").split("_"):
        number = _number(raw)
        if number is not None and number > 0:
            levels.append(number)
    return levels


def parse_stock_quotes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for raw in payload.get("msgArray") or []:
        code = str(raw.get("c") or "")
        if not code or code.lower() in {"t00", "o00"}:
            continue
        reference = _number(raw.get("y"))
        exact = _number(raw.get("z"))
        bids = _levels(raw.get("b"))
        asks = _levels(raw.get("a"))
        best_bid = max(bids) if bids else None
        best_ask = min(asks) if asks else None
        current = exact
        basis = "last_trade"
        if current is None and best_bid is not None and best_ask is not None:
            current = (best_bid + best_ask) / 2.0
            basis = "bid_ask_mid"
        elif current is None and best_bid is not None:
            current = best_bid
            basis = "best_bid"
        elif current is None and best_ask is not None:
            current = best_ask
            basis = "best_ask"
        elif current is None:
            current = _number(raw.get("o"))
            basis = "open"
        change_pct = current / reference - 1.0 if current is not None and reference else None
        rows.append({
            "code": code,
            "name": str(raw.get("n") or code),
            "market": str(raw.get("ex") or ""),
            "quote_at": _quote_time(raw),
            "reference": reference,
            "value": current,
            "change_pct": change_pct,
            "price_basis": basis,
            "open": _number(raw.get("o")),
            "high": _number(raw.get("h")),
            "low": _number(raw.get("l")),
            "best_bid": best_bid,
            "best_ask": best_ask,
            "volume": _number(raw.get("v")),
        })
    return rows


def market_phase(now: dt.datetime, closed_dates: list[str]) -> tuple[str, str]:
    today = now.date().isoformat()
    if now.weekday() >= 5 or today in set(closed_dates):
        return "closed", "休市"
    clock = now.time()
    if clock < dt.time(8, 30):
        return "overnight", "盤前準備"
    if clock < dt.time(9, 0):
        return "preopen", "盤前試撮"
    if clock <= dt.time(13, 30):
        return "intraday", "盤中"
    if clock < dt.time(14, 30):
        return "closing", "收盤整理"
    return "afterhours", "盤後"


def _tone(value: float, *, positive: float, negative: float) -> str:
    if value >= positive:
        return "positive"
    if value <= negative:
        return "negative"
    return "neutral"


def _overnight_tone(rows: list[dict[str, Any]]) -> tuple[str, float]:
    values = {row["key"]: float(row.get("return") or 0.0) for row in rows}
    score = (
        values.get("SOX", 0.0) * 0.45
        + values.get("IXIC", 0.0) * 0.35
        + values.get("TSM", 0.0) * 0.20
    )
    return _tone(score, positive=0.005, negative=-0.005), score


def _plain_tone(tone: str) -> str:
    return {"positive": "偏正向", "negative": "偏保守", "neutral": "中性"}[tone]


def _apply_entry_performance(
    row: dict[str, Any], quote_by_code: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Attach an honest mark-to-market view without inventing an entry."""
    quote = quote_by_code.get(str(row.get("code") or "")) or {}
    current_price = quote.get("value")
    current_price_at = quote.get("quote_at")
    current_price_basis = quote.get("price_basis")
    if current_price is None and row.get("latest_price") is not None:
        current_price = row.get("latest_price")
        current_price_at = row.get("latest_price_date")
        current_price_basis = "latest_close"

    entry_price = row.get("entry_price")
    row["current_price"] = current_price
    row["current_price_at"] = current_price_at
    row["current_price_basis"] = current_price_basis
    if not row.get("entry_date") or entry_price is None:
        row["tracking_status"] = "awaiting_entry"
        row["return_since_entry"] = None
    elif current_price is None or float(entry_price) <= 0:
        row["tracking_status"] = "price_unavailable"
        row["return_since_entry"] = None
    else:
        row["tracking_status"] = "current"
        row["return_since_entry"] = float(current_price) / float(entry_price) - 1.0
    return row


def _merge_candidate_quotes(
    rows: list[dict[str, Any]], quotes: list[dict[str, Any]], *, avoid: bool = False
) -> list[dict[str, Any]]:
    quote_by_code = {row["code"]: row for row in quotes}
    merged = []
    for source in rows:
        row = dict(source)
        quote = quote_by_code.get(str(row.get("code") or "")) or {}
        row["quote"] = quote
        _apply_entry_performance(row, quote_by_code)
        model_close = float(row.get("model_close") or 0.0)
        reference = quote.get("reference")
        reference_gap = (
            float(reference) / model_close - 1.0
            if reference is not None and model_close else None
        )
        row["reference_gap"] = reference_gap
        change = quote.get("change_pct")
        return_20d = float(row.get("return_20d") or 0.0)
        distance_ma20 = float(row.get("distance_ma20") or 0.0)
        overextension = []
        if return_20d > MAX_ENTRY_RETURN_20D:
            overextension.append(f"近20日已上漲{return_20d:.1%}")
        if distance_ma20 > MAX_ENTRY_DISTANCE_MA20:
            overextension.append(f"距月線已達{distance_ma20:.1%}")
        if change is not None and float(change) >= MAX_ENTRY_INTRADAY_CHANGE:
            overextension.append(f"今日已上漲{float(change):.1%}")

        if avoid:
            row["decision_key"] = "avoid"
            row["decision_label"] = "避免／只觀察反彈"
            row["decision_reason"] = row.get("avoid_reason") or "風險條件未通過"
        elif reference_gap is not None and abs(reference_gap) >= 0.05:
            row["decision_key"] = "data_check"
            row["decision_label"] = "價格基準異常，先排除"
            row["decision_reason"] = "官方參考價與模型收盤差逾 5%，可能有除權息或價格調整。"
        elif overextension:
            row["decision_key"] = "no_chase"
            row["decision_label"] = "已漲多，只等拉回"
            row["decision_reason"] = (
                "；".join(overextension)
                + "。相對強勢只供研究排序，不代表現在是買點。"
            )
        elif change is None:
            row["decision_key"] = "waiting"
            row["decision_label"] = "等待盤中確認"
            row["decision_reason"] = "前瞻訊號已凍結，但目前沒有可用盤中參考價。"
        elif float(change) <= -0.03:
            row["decision_key"] = "weakening"
            row["decision_label"] = "盤中轉弱，暫停觀察"
            row["decision_reason"] = "今日走勢與原研究方向相反，等待收盤資料重新確認。"
        elif len(row.get("risk_flags") or []) >= 2:
            row["decision_key"] = "caution"
            row["decision_label"] = "訊號成立，但風險偏高"
            row["decision_reason"] = "訊號已在收盤後凍結，但目前仍有多項風險。"
        else:
            row["decision_key"] = "watch"
            row["decision_label"] = "前瞻觀察中"
            row["decision_reason"] = "這是收盤後已凍結的v5訊號；結果只按既定5日／20日規則結算。"
        merged.append(row)

    priority = {
        "watch": 0, "caution": 1, "no_chase": 2, "waiting": 3,
        "weakening": 4, "data_check": 5, "avoid": 6,
    }
    merged.sort(key=lambda row: (
        priority.get(row.get("decision_key"), 9),
        -int(row.get("evidence_passed") or 0),
        -float(row.get("relative_20d") or 0.0),
    ))
    return merged


def _quote_matches_session(row: dict[str, Any], session_date: dt.date) -> bool:
    value = row.get("quote_at")
    if not isinstance(value, str):
        return False
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TAIPEI)
    return parsed.astimezone(TAIPEI).date() == session_date


def build_snapshot(
    context: dict[str, Any],
    *,
    now: dt.datetime | None = None,
    fetcher: Callable[[], dict[str, Any]] | None = fetch_indices,
) -> dict[str, Any]:
    now = _now_taipei(now)
    phase, phase_label = market_phase(now, list(context.get("closed_dates") or []))
    source_error = None
    quotes: list[dict[str, Any]] = []
    stock_quotes: list[dict[str, Any]] = []
    if fetcher is not None:
        try:
            if fetcher is fetch_indices:
                channels = "|".join([
                    INDEX_CHANNELS,
                    *[str(value) for value in context.get("quote_channels") or []],
                ])
                payload = fetch_indices(channels)
            else:
                payload = fetcher()
            quotes = parse_indices(payload)
            stock_quotes = parse_stock_quotes(payload)
        except Exception as exc:  # network failures must degrade to a labeled snapshot
            source_error = type(exc).__name__

    stale_intraday_payload = False
    if phase == "intraday":
        original_quote_count = len(quotes) + len(stock_quotes)
        quotes = [row for row in quotes if _quote_matches_session(row, now.date())]
        stock_quotes = [
            row for row in stock_quotes if _quote_matches_session(row, now.date())
        ]
        stale_intraday_payload = original_quote_count > 0 and not quotes and not stock_quotes

    overnight_tone, overnight_score = _overnight_tone(context.get("overnight") or [])
    breadth = context.get("breadth") or {}
    breadth_score = int(breadth.get("score") or 0)
    structure_tone = "positive" if breadth_score >= 70 else "neutral" if breadth_score >= 55 else "negative"
    taiex = next((row for row in quotes if row["market"] == "tse"), None)
    otc = next((row for row in quotes if row["market"] == "otc"), None)
    live_change = taiex.get("change_pct") if taiex else None
    live_tone = (
        _tone(float(live_change), positive=0.006, negative=-0.006)
        if live_change is not None else None
    )
    experiment = copy.deepcopy(context.get("experiment") or {})
    quote_by_code = {row["code"]: row for row in stock_quotes}
    for key in ("latest_signals", "awaiting_entry", "open_trials"):
        for row in experiment.get(key) or []:
            _apply_entry_performance(row, quote_by_code)
    for group in experiment.get("ai_groups") or []:
        for key in ("latest_picks", "tracking_picks", "awaiting_latest_entry"):
            for row in group.get(key) or []:
                _apply_entry_performance(row, quote_by_code)

    candidates = _merge_candidate_quotes(
        list(context.get("candidates") or []), stock_quotes
    )
    avoids = _merge_candidate_quotes(
        list(context.get("avoids") or []), stock_quotes, avoid=True
    )
    decision_counts = {
        key: sum(1 for row in candidates if row.get("decision_key") == key)
        for key in ["watch", "caution", "no_chase", "weakening", "data_check", "waiting"]
    }
    directly_watchable = decision_counts["watch"]
    guarded_watch = decision_counts["caution"]
    if not candidates:
        headline = "前瞻實驗：今日尚無新的凍結訊號"
        summary = str(experiment.get("message") or "不以未凍結的即時排名代替正式前瞻訊號。")
    elif phase == "intraday" and live_tone:
        if directly_watchable:
            headline = f"盤中：{directly_watchable} 檔v5前瞻訊號仍在觀察"
        elif guarded_watch:
            headline = "盤中：v5訊號目前都伴隨額外風險"
        else:
            headline = "盤中：目前沒有仍符合觀察條件的v5訊號"
        summary = (
            f"候選已在訊號日收盤後寫入P2不可變帳本，再用今日官方盤中報價做狀態確認；"
            f"{decision_counts['no_chase']} 檔已漲多不追，{decision_counts['weakening']} 檔轉弱暫停。"
        )
    elif phase in {"preopen", "overnight"}:
        headline = f"盤前：{len(candidates)} 檔已凍結v5訊號等待隔日開盤"
        summary = "只顯示P2已記錄的訊號；開盤價將作為模擬進場價，不使用事後最佳價格。"
    elif phase == "closed":
        headline = "休市：保留最近一批已凍結前瞻訊號"
        summary = "今天不是一般交易日；不新增、不回填，也不把休市日當成資料延遲。"
    else:
        formal_date = context.get("latest_completed_session")
        paper_date = experiment.get("latest_market_date")
        if paper_date != formal_date:
            headline = "盤後：等待P2前瞻帳本完成今日更新"
            summary = "正式資料已完成，但P2尚未確認同一市場日；更新前不新增也不回填訊號。"
        elif experiment.get("status") == "no_eligible":
            headline = "盤後：今日沒有股票通過v5買進門檻"
            summary = str(experiment.get("message") or "固定門檻不放寬；既有批次繼續追蹤。")
        elif experiment.get("status") == "pending_next_open":
            headline = f"盤後：{len(candidates)} 檔v5新訊號已凍結"
            summary = "等待下一個交易日開盤作為模擬買入價；不拿訊號日收盤價代替。"
        else:
            headline = "盤後：v5前瞻帳本已完成今日更新"
            summary = "既有模擬部位照固定5日／20日規則追蹤，不因盤後排名變動而改寫。"

    quote_state = "unavailable"
    if source_error:
        quote_state = "unavailable"
    elif phase in {"preopen", "overnight", "closed"}:
        quote_state = "waiting"
    elif live_change is not None:
        quote_state = "current"
    elif quotes:
        quote_state = "waiting"
    if stale_intraday_payload:
        quote_state = "waiting"

    divergence = None
    if taiex and otc and taiex.get("change_pct") is not None and otc.get("change_pct") is not None:
        divergence = float(otc["change_pct"]) - float(taiex["change_pct"])

    analyses = [
        {
            "title": "隔夜環境",
            "tone": overnight_tone,
            "text": f"SOX、NASDAQ 與台積電 ADR 的加權訊號為{_plain_tone(overnight_tone)}；它只描述開盤前背景，不代表台股一定同方向。",
        },
        {
            "title": "市場結構",
            "tone": structure_tone,
            "text": f"上一完成盤廣度 {breadth_score}/100，{breadth.get('above_ma20', 0.0):.0%} 樣本在 20 日線上；這是中短期結構，不是今日盤中漲跌家數。",
        },
    ]
    if live_change is not None:
        analyses.append({
            "title": "今日指數",
            "tone": live_tone,
            "text": f"加權指數目前 {float(live_change):+.2%}。" + (
                f"櫃買相對加權差 {divergence:+.2%}，可用來觀察中小型股是否同步。"
                if divergence is not None else "櫃買資料尚不足，暫不判斷大小型股分歧。"
            ),
        })

    watchpoints = [
        "v5固定門檻：20日漲幅2%～20%、距月線-3%～+5%、合理波動與量能；不為了湊名單放寬。",
        "官方參考價與模型收盤差逾 5% 時，先視為除權息或價格調整，暫停評分。",
        "訊號日後一律用隔日開盤模擬，固定結算5日與20日，扣成本後再和0050比較。",
    ]

    return {
        "schema_version": 2,
        "generated_at": now.isoformat(timespec="seconds"),
        "timezone": "Asia/Taipei",
        "phase": {"key": phase, "label": phase_label},
        "headline": headline,
        "summary": summary,
        "quote_state": quote_state,
        "quote_error": source_error or ("stale_session" if stale_intraday_payload else None),
        "indices": quotes,
        "latest_completed_session": context.get("latest_completed_session"),
        "prior_session": context.get("prior_session") or {},
        "breadth": breadth,
        "sectors": context.get("sectors") or [],
        "candidates": candidates,
        "avoids": avoids,
        "decision_counts": decision_counts,
        "research_rules": context.get("research_rules") or [],
        "research_state": context.get("research_state") or {},
        "experiment": experiment,
        "exposure_experiment": copy.deepcopy(context.get("exposure_experiment") or {}),
        "risk_observation": context.get("risk_observation") or {},
        "overnight": context.get("overnight") or [],
        "overnight_score": overnight_score,
        "analysis": analyses,
        "watchpoints": watchpoints,
        "sources": context.get("sources") or [],
        "safety": context.get("safety") or {},
    }


def write_snapshot(snapshot: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "market.json"
    js_path = output_dir / "market-data.js"
    encoded = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    json_path.write_text(encoded, encoding="utf-8")
    js_path.write_text("window.STOCKGO_MARKET = " + encoded.rstrip() + ";\n", encoding="utf-8")
    return json_path, js_path


def export_market(
    *,
    formal_db: Path,
    reports: Path,
    calendar_path: Path,
    output_dir: Path,
    benchmark: str,
    paper_db: Path | None = None,
    paper_reports: Path | None = None,
    now: dt.datetime | None = None,
    fetcher: Callable[[], dict[str, Any]] | None = fetch_indices,
) -> tuple[Path, Path, Path]:
    now = _now_taipei(now)
    context = build_context(
        formal_db, reports, calendar_path, benchmark=benchmark, now=now,
        paper_db=paper_db, paper_reports=paper_reports,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    context_path = output_dir / "market-context.json"
    context_path.write_text(
        json.dumps(context, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    json_path, js_path = write_snapshot(
        build_snapshot(context, now=now, fetcher=fetcher), output_dir
    )
    return json_path, js_path, context_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data"))
    parser.add_argument("--no-fetch", action="store_true")
    args = parser.parse_args()
    context = json.loads(args.context.read_text(encoding="utf-8"))
    snapshot = build_snapshot(context, fetcher=None if args.no_fetch else fetch_indices)
    json_path, js_path = write_snapshot(snapshot, args.output)
    print(f"wrote {json_path}")
    print(f"wrote {js_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
