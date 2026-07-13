"""Build StockGO's aggregate-only daily market snapshot.

The public workflow reads a pre-aggregated context file, fetches only the two
official market indices, and publishes analysis rather than raw quote feeds.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
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


def build_context(
    formal_db: Path,
    reports: Path,
    calendar_path: Path,
    *,
    benchmark: str,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Read only aggregate context from the formal database and latest card."""
    now = _now_taipei(now)
    card = _latest_card(reports)
    card_market = card.get("market") or {}
    breadth = card_market.get("breadth") or {}
    sectors = card_market.get("sector_strength") or []

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

    return {
        "schema_version": 1,
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
                "name": "StockGO 正式庫彙總",
                "freshness": latest_market_date,
                "note": "上一完成盤的市場廣度、產業結構與隔夜市場資料。",
            },
            {
                "name": "臺灣證券交易所市場資訊",
                "url": TWSE_INFORMATION,
                "note": "盤中只發布兩個市場指數的彙總變化，不發布逐筆或個股行情。",
            },
            {
                "name": "臺灣證券交易所交易制度",
                "url": TWSE_TRADING,
                "note": "一般交易撮合時間為 09:00–13:30。",
            },
        ],
        "safety": {
            "live_trading": False,
            "individual_stocks": False,
            "advice": False,
        },
    }


def fetch_indices(timeout: float = 15.0) -> dict[str, Any]:
    query = urllib.parse.urlencode({
        "ex_ch": INDEX_CHANNELS,
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
    labels = {"tse": "加權指數", "otc": "櫃買指數"}
    rows = []
    for raw in payload.get("msgArray") or []:
        market = str(raw.get("ex") or "")
        if market not in labels:
            continue
        reference = _number(raw.get("y"))
        current = _number(raw.get("z"))
        change_pct = None
        if current is not None and reference:
            change_pct = current / reference - 1.0
        rows.append({
            "market": market,
            "name": labels[market],
            "date": str(raw.get("d") or ""),
            "quote_at": _quote_time(raw),
            "reference": reference,
            "value": current,
            "change_pct": change_pct,
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
    if fetcher is not None:
        try:
            quotes = parse_indices(fetcher())
        except Exception as exc:  # network failures must degrade to a labeled snapshot
            source_error = type(exc).__name__

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

    if phase == "intraday" and live_tone:
        headline = f"盤中：指數{_plain_tone(live_tone)}，結構仍{_plain_tone(structure_tone)}"
        summary = "盤中指數反映今天已成交的變化；市場廣度與產業資料仍是上一完成盤，兩者分開判讀。"
    elif phase in {"preopen", "overnight"}:
        headline = f"盤前：外部訊號{_plain_tone(overnight_tone)}，內部結構{_plain_tone(structure_tone)}"
        summary = "台股尚未開始一般交易；目前先看隔夜市場與上一完成盤結構，開盤後才加入今日指數。"
    elif phase == "closed":
        headline = f"休市：外部訊號{_plain_tone(overnight_tone)}，保留上一完成盤結構"
        summary = "今天不是一般交易日；頁面保留最近可驗證資料，不把休市日當成延遲。"
    else:
        headline = f"盤後：指數{_plain_tone(live_tone or 'neutral')}，等待正式收盤資料入庫"
        summary = "盤中指數可作今日概況；完整廣度、產業與法人資料要等 Evening 流程完成後才定稿。"

    quote_state = "unavailable"
    if source_error:
        quote_state = "unavailable"
    elif phase in {"preopen", "overnight", "closed"}:
        quote_state = "waiting"
    elif live_change is not None:
        quote_state = "current"
    elif quotes:
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
        "盤中只用指數判讀今天方向；上一盤廣度不能冒充今日漲跌家數。",
        "若加權與櫃買方向分歧，先視為市場參與不一致，不追逐單一指數。",
        "產業排名是 20 日結構，需等正式收盤資料更新後才能確認是否延續。",
    ]

    return {
        "schema_version": 1,
        "generated_at": now.isoformat(timespec="seconds"),
        "timezone": "Asia/Taipei",
        "phase": {"key": phase, "label": phase_label},
        "headline": headline,
        "summary": summary,
        "quote_state": quote_state,
        "quote_error": source_error,
        "indices": quotes,
        "latest_completed_session": context.get("latest_completed_session"),
        "prior_session": context.get("prior_session") or {},
        "breadth": breadth,
        "sectors": context.get("sectors") or [],
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
    now: dt.datetime | None = None,
    fetcher: Callable[[], dict[str, Any]] | None = fetch_indices,
) -> tuple[Path, Path, Path]:
    now = _now_taipei(now)
    context = build_context(
        formal_db, reports, calendar_path, benchmark=benchmark, now=now
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
