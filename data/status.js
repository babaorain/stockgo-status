window.STOCKGO_STATUS = {
  "schema_version": 2,
  "generated_at": "2026-07-24T23:51:16+08:00",
  "timezone": "Asia/Taipei",
  "headline": "資料建置中，尚未開放交易",
  "summary": "正式庫負責日常研究；P2 只保存前瞻驗證證據。所有交易功能維持停用。",
  "formal": {
    "file": "stockgo.sqlite",
    "role": "日常研究主庫；所有研究報告、特徵與模型檢查以此為準。",
    "latest_market_date": "2026-07-24",
    "expected_market_date": "2026-07-24",
    "market_session_lag": 0,
    "missing_market_dates": [],
    "status": "building",
    "blockers": [
      "舊版 v2 Labels 尚未補齊"
    ],
    "datasets": [
      {
        "key": "prices",
        "label": "台股行情",
        "date": "2026-07-24",
        "rows": 3086645,
        "status": "current",
        "note": "正式庫的收盤行情基準",
        "expected_date": "2026-07-24"
      },
      {
        "key": "features",
        "label": "Features",
        "date": "2026-07-24",
        "rows": 2881193,
        "status": "current",
        "note": "研究與模型使用的衍生特徵",
        "expected_date": "2026-07-24"
      },
      {
        "key": "universe",
        "label": "歷史股票池",
        "date": "2026-07-24",
        "rows": 3075490,
        "status": "current",
        "note": "避免存活者偏差的每日股票池",
        "expected_date": "2026-07-24"
      },
      {
        "key": "labels",
        "label": "舊版 v2 Labels（20 日）",
        "date": "2026-06-24",
        "rows": 2814216,
        "status": "delayed",
        "note": "僅供舊研究維護；不可作為新模型標籤或交易訊號",
        "expected_date": "2026-06-25"
      },
      {
        "key": "legal",
        "label": "三大法人",
        "date": "2026-07-24",
        "rows": 1519865,
        "status": "current",
        "note": "法人買賣超資料",
        "expected_date": "2026-07-24"
      },
      {
        "key": "margin",
        "label": "融資融券",
        "date": "2026-07-24",
        "rows": 1077529,
        "status": "current",
        "note": "信用交易餘額",
        "expected_date": "2026-07-24"
      },
      {
        "key": "futures",
        "label": "期貨未平倉",
        "date": "2026-07-24",
        "rows": 5943,
        "status": "current",
        "note": "TAIFEX 外資未平倉",
        "expected_date": "2026-07-24"
      },
      {
        "key": "macro",
        "label": "美股與 SOX",
        "date": "2026-07-23",
        "rows": 7596,
        "status": "delayed",
        "note": "隔夜市場環境",
        "expected_date": "2026-07-24"
      },
      {
        "key": "revenue",
        "label": "月營收",
        "date": "2026-07-17",
        "rows": 56940,
        "status": "current",
        "note": "依公司公告週期更新"
      },
      {
        "key": "financial",
        "label": "財報品質",
        "date": "2026-05-15",
        "rows": 18821,
        "status": "current",
        "note": "依季報公告週期更新"
      }
    ]
  },
  "p2": {
    "file": "stockgo.p2.sqlite",
    "role": "前瞻驗證證據庫；只保存當時可知資料與不可竄改的驗證紀錄。",
    "latest_market_date": "2026-07-21",
    "status": "collecting",
    "blockers": [
      "已登記研究尚無完成結果",
      "模擬券商尚無對帳證據"
    ],
    "metrics": {
      "paper_total": 3948,
      "paper_current_protocol": 90,
      "paper_settled": 1563,
      "paper_pending": 2385,
      "forecast_rows": 2203,
      "dataset_snapshots": 3,
      "trial_plans": 3,
      "trial_results": 0,
      "broker_campaigns": 0,
      "broker_sessions": 0,
      "broker_orders": 0,
      "broker_events": 0,
      "broker_reconciliations": 0,
      "review_packets": 0,
      "review_decisions": 0,
      "current_trial": {
        "ready_for_evaluation": false,
        "holdout_start_date": null,
        "registered_at": "2026-07-22T11:58:05",
        "status": "collecting",
        "market_sessions": 0,
        "signal_days": 0,
        "months_observed": 0,
        "minimum_calendar_months": 6,
        "pending_signal_rows": 0,
        "minimum_signal_days": 30,
        "historical_backfill_allowed": false,
        "latest_holdout_date": null
      },
      "live_enabled_rows": 0
    }
  },
  "stages": [
    {
      "name": "資料健康",
      "status": "in_progress",
      "description": "正式庫行情、特徵、股票池與標籤保持一致。"
    },
    {
      "name": "前瞻證據",
      "status": "in_progress",
      "description": "依時間順序累積 paper 與研究試驗證據。"
    },
    {
      "name": "交易準備",
      "status": "waiting",
      "description": "模擬券商、影子投組與人工審查全部通過後才評估。"
    }
  ],
  "operations": [
    {
      "key": "morning",
      "name": "Morning",
      "schedule": "交易日 07:00",
      "purpose": "盤前資料與研究狀態整理",
      "status": "success",
      "last_run_status": "success",
      "due_state": "complete",
      "scheduled_for": "2026-07-24",
      "schedule_time": "07:00",
      "deadline_time": "08:00",
      "stale": false,
      "started_at": "2026-07-24T07:00:04+08:00",
      "finished_at": "2026-07-24T07:11:25+08:00",
      "duration_seconds": 680.3,
      "error": null,
      "dashboard_refresh_status": "success",
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "risk_observation",
      "name": "Risk Observation",
      "schedule": "交易日 08:20",
      "purpose": "凍結獨立的盤前風險學習紀錄",
      "status": "success",
      "last_run_status": "success",
      "due_state": "complete",
      "scheduled_for": "2026-07-24",
      "schedule_time": "08:20",
      "deadline_time": "09:00",
      "stale": false,
      "started_at": "2026-07-24T08:20:04+08:00",
      "finished_at": "2026-07-24T08:20:07+08:00",
      "duration_seconds": 2.5,
      "error": null,
      "dashboard_refresh_status": "skipped",
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "evening",
      "name": "Evening",
      "schedule": "交易日 18:30",
      "purpose": "正式庫收盤資料補齊與完整性檢查",
      "status": "failed",
      "last_run_status": "failed",
      "due_state": "overdue",
      "scheduled_for": "2026-07-24",
      "schedule_time": "18:30",
      "deadline_time": "22:30",
      "stale": false,
      "started_at": "2026-07-24T18:30:04+08:00",
      "finished_at": "2026-07-24T18:54:47+08:00",
      "duration_seconds": 1482.7,
      "error": "必要步驟失敗，請查看本機紀錄。",
      "dashboard_refresh_status": null,
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "paper",
      "name": "Paper",
      "schedule": "交易日 19:30",
      "purpose": "P2 前瞻證據收集與保存",
      "status": "failed",
      "last_run_status": "failed",
      "due_state": "overdue",
      "scheduled_for": "2026-07-24",
      "schedule_time": "19:30",
      "deadline_time": "22:45",
      "stale": false,
      "started_at": "2026-07-24T19:30:01+08:00",
      "finished_at": "2026-07-24T22:30:00+08:00",
      "duration_seconds": 10799.5,
      "error": "必要步驟失敗，請查看本機紀錄。",
      "dashboard_refresh_status": null,
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "ai_database",
      "name": "AI 資料庫組",
      "schedule": "交易日 22:15",
      "purpose": "只讀正式資料快照的 AI 紙上對照組",
      "status": "failed",
      "last_run_status": "failed",
      "due_state": "overdue",
      "scheduled_for": "2026-07-24",
      "schedule_time": "22:15",
      "deadline_time": "23:40",
      "stale": false,
      "started_at": "2026-07-24T22:15:01+08:00",
      "finished_at": "2026-07-24T22:45:00+08:00",
      "duration_seconds": 1799.4,
      "error": "必要步驟失敗，請查看本機紀錄。",
      "dashboard_refresh_status": null,
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "ai_web",
      "name": "純網路 AI 組",
      "schedule": "交易日 22:30",
      "purpose": "只讀公開網路資訊的 AI 紙上對照組",
      "status": "failed",
      "last_run_status": "failed",
      "due_state": "overdue",
      "scheduled_for": "2026-07-24",
      "schedule_time": "22:30",
      "deadline_time": "23:40",
      "stale": false,
      "started_at": "2026-07-24T22:30:01+08:00",
      "finished_at": "2026-07-24T22:45:00+08:00",
      "duration_seconds": 898.8,
      "error": "必要步驟失敗，請查看本機紀錄。",
      "dashboard_refresh_status": null,
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "watchdog_core",
      "name": "核心驗收",
      "schedule": "交易日 22:50",
      "purpose": "驗收 Morning、Risk、Evening 與 Paper",
      "status": "failed",
      "last_run_status": "failed",
      "due_state": "overdue",
      "scheduled_for": "2026-07-24",
      "schedule_time": "22:50",
      "deadline_time": "23:00",
      "stale": false,
      "started_at": "2026-07-24T22:50:00+08:00",
      "finished_at": "2026-07-24T22:50:04+08:00",
      "duration_seconds": 4.1,
      "error": "必要步驟失敗，請查看本機紀錄。",
      "dashboard_refresh_status": null,
      "dashboard_refresh_error": null,
      "has_local_log": true
    },
    {
      "key": "watchdog_ai",
      "name": "AI 驗收",
      "schedule": "交易日 23:50",
      "purpose": "驗收兩個 AI 對照組與跨日覆蓋",
      "status": "running",
      "last_run_status": "running",
      "due_state": "due",
      "scheduled_for": "2026-07-24",
      "schedule_time": "23:50",
      "deadline_time": "23:59",
      "stale": false,
      "started_at": "2026-07-24T23:50:00+08:00",
      "finished_at": null,
      "duration_seconds": null,
      "error": null,
      "dashboard_refresh_status": null,
      "dashboard_refresh_error": null,
      "has_local_log": true
    }
  ],
  "alpha_inventory": {
    "status": "complete",
    "conclusion": "歷史因子未達門檻，暫停機器學習",
    "explanation": "15 個預先登記因子中有 0 個同時通過統計、成本後報酬與穩健性門檻；歷史年份已被檢視，不冒充全新樣本。",
    "as_of": "2025-11-30",
    "protocol_frozen": true,
    "formation_weeks": 305,
    "candidate_rows": 61000,
    "factor_count": 15,
    "data_ready_factor_count": 9,
    "passed_factor_count": 0,
    "ml_candidate_eligible": false,
    "blockers": [
      "通過的獨立因子不足",
      "通過的不同因子家族不足"
    ],
    "next_action": "停止追加歷史因子與 ML；先修正資料時點與覆蓋缺口，再決定是否登記單一探索性前瞻觀察。",
    "erratum_reviewed": true
  },
  "actions": [
    {
      "title": "完成正式庫對齊",
      "detail": "補齊行情後重建 Features、歷史股票池與 v2 Labels。"
    },
    {
      "title": "完成已登記研究試驗",
      "detail": "使用凍結資料快照執行並保存結果，避免事後改規則。"
    },
    {
      "title": "建立模擬券商對帳",
      "detail": "研究證據足夠後，驗證委託、成交、成本與現金部位。"
    },
    {
      "title": "保留人工審查關卡",
      "detail": "所有機械驗證完成後才建立審查封包；目前不可開放交易。"
    }
  ],
  "safety": {
    "live_trading": false,
    "public_data_policy": "只發布彙總狀態，不包含資料庫、token、持倉、個股清單或策略參數。"
  },
  "operations_refreshed_at": "2026-07-24T23:51:16+08:00"
};
