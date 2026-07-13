(function () {
  "use strict";

  const data = window.STOCKGO_MARKET;
  if (!data) {
    document.getElementById("market-headline").textContent = "今日決策資料尚未產生";
    document.getElementById("market-summary").textContent = "請先執行 Dashboard 更新流程。";
    return;
  }

  const text = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
  const esc = value => text(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
  const percent = value => value === null || value === undefined ? "—" : new Intl.NumberFormat("zh-TW", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2, signDisplay: "always"
  }).format(value);
  const plainPercent = value => value === null || value === undefined ? "—" : new Intl.NumberFormat("zh-TW", {
    style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 1
  }).format(value);
  const price = value => value === null || value === undefined ? "待報價" : new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: Number(value) >= 1000 ? 0 : 2, maximumFractionDigits: 2
  }).format(value);
  const integer = value => new Intl.NumberFormat("zh-TW").format(Number(value || 0));
  const localTime = value => value ? new Date(value).toLocaleString("zh-TW", {
    hour12: false, timeZone: "Asia/Taipei"
  }) : "—";
  const tone = value => value > 0.006 ? "movement-up" : value < -0.006 ? "movement-down" : "neutral";
  const returnTone = value => value > 0 ? "movement-up" : value < 0 ? "movement-down" : "neutral";
  const decisionTone = key => ({
    watch: "positive", caution: "caution", no_chase: "warning",
    weakening: "negative", data_check: "negative", waiting: "neutral", avoid: "negative"
  })[key] || "neutral";
  const basisLabel = basis => ({
    last_trade: "最近成交", bid_ask_mid: "委買賣中價", best_bid: "最佳委買",
    best_ask: "最佳委賣", open: "今日開盤", latest_close: "最近收盤"
  })[basis] || "盤中參考";
  const entryPerformanceHtml = row => {
    if (!row.entry_date || row.tracking_status === "awaiting_entry") {
      return `<div class="entry-performance waiting"><strong>等待模擬買入</strong><span>下一個交易日開盤才建立進場價</span></div>`;
    }
    if (row.tracking_status !== "current" || row.return_since_entry === null || row.return_since_entry === undefined) {
      return `<div class="entry-performance unavailable"><strong>績效待更新</strong><span>模擬買入 ${esc(price(row.entry_price))} · 尚無可用現價</span></div>`;
    }
    const at = row.current_price_at ? text(row.current_price_at) : "時間待確認";
    return `<div class="entry-performance"><strong class="${returnTone(row.return_since_entry)}">截至目前 ${esc(percent(row.return_since_entry))}</strong><span>模擬買入 ${esc(price(row.entry_price))} · ${esc(basisLabel(row.current_price_basis))} ${esc(price(row.current_price))}</span><small>${esc(row.entry_date)} 買入 · 報價日 ${esc(at)}</small></div>`;
  };

  document.getElementById("market-phase").textContent = data.phase.label;
  document.getElementById("market-headline").textContent = data.headline;
  document.getElementById("market-summary").textContent = data.summary;
  document.getElementById("market-updated-at").textContent = `最後更新：${localTime(data.generated_at)}`;
  const quoteLabels = { current: "盤中報價已更新", waiting: "等待開盤或新撮合", unavailable: "官方來源暫時不可用" };
  document.getElementById("market-freshness").textContent = `${quoteLabels[data.quote_state] || "狀態確認中"}；模型資料日：${text(data.research_state.latest_feature_date)}；正式策略：尚未啟用`;

  const exposure = data.exposure_experiment && typeof data.exposure_experiment === "object"
    ? data.exposure_experiment : {};
  let exposureArms = Array.isArray(exposure.arms) ? exposure.arms
    .filter(row => row && typeof row === "object" && typeof row.arm_id === "string")
    .slice(0, 4)
    .map(row => ({
      ...row,
      reason_labels: Array.isArray(row.reason_labels)
        ? row.reason_labels.filter(reason => typeof reason === "string").slice(0, 3) : []
    })) : [];
  const exposureGateLabels = {
    historical_pass: "通過・可開始前瞻追蹤",
    historical_fail: "未通過・停止",
    insufficient_history: "資料不足・停止",
    invalid_data: "資料無效・停止",
    not_run: "尚未執行"
  };
  const allowedExposureGates = new Set([
    "historical_pass", "historical_fail", "insufficient_history", "invalid_data", "not_run"
  ]);
  let exposureGateStatus = allowedExposureGates.has(exposure.historical_gate_status)
    ? exposure.historical_gate_status : "invalid_data";
  if (exposureGateStatus === "historical_pass" && !(
    exposure.protocol_registered === true
    && exposure.paper_only === true
    && exposure.no_backfill === true
    && exposure.prospective === true
    && exposure.status === "historical_pass_tracking_allowed"
  )) exposureGateStatus = "invalid_data";
  if (exposureGateStatus === "invalid_data") exposureArms = [];
  const exposureById = Object.fromEntries(exposureArms.map(row => [row.arm_id, row]));
  const tactical0050 = exposureById.tactical_0050 || {};
  const buyhold0050 = exposureById.buyhold_0050 || {};
  const exposureGateTone = exposureGateStatus === "historical_pass" ? "passed"
    : ["historical_fail", "insufficient_history", "invalid_data"].includes(exposureGateStatus)
      ? "failed" : "waiting";
  const exposureTitle = exposureGateStatus === "historical_fail"
    ? "降低跌幅，不代表能累積更多財富"
    : exposureGateStatus === "historical_pass"
      ? "歷史門檻通過，但還不是可交易結論"
      : exposureGateStatus === "insufficient_history"
        ? "資料不足，停止判讀"
        : exposureGateStatus === "invalid_data"
          ? "資料驗證未通過，停止使用"
          : "先凍結規則，再等待可驗證結果";
  document.getElementById("exposure-gate").innerHTML = `
    <div class="exposure-seal ${exposureGateTone}"><span>歷史閘門</span><strong>${esc(exposureGateLabels[exposureGateStatus] || "狀態確認中")}</strong><small>紙上研究 · 永不自動下單</small></div>
    <div class="exposure-gate-copy"><p class="eyebrow">DECISION, NOT A SALES PITCH</p><h3>${esc(exposureTitle)}</h3><p>${esc(exposure.message || "曝險實驗資料尚未產生。")}</p><div class="exposure-findings"><span>${esc((tactical0050.reason_labels || ["尚無統計結論"])[0])}</span><span>最大回撤 ${esc(plainPercent(tactical0050.max_drawdown))} vs 持有 ${esc(plainPercent(buyhold0050.max_drawdown))}</span><span>前瞻排程：${exposure.prospective === true ? "可建立，但仍只追蹤" : "未建立"}</span></div></div>
    <dl><div><dt>資料截至</dt><dd>${esc(exposure.as_of_session || "—")}</dd></div><div><dt>前瞻樣本</dt><dd>${esc(exposure.sample_sessions || 0)} 日</dd></div><div><dt>同日估值覆蓋</dt><dd>${esc(exposure.coverage_note || (exposure.coverage_complete ? "全部完整" : "待確認"))}</dd></div></dl>`;

  const exposureCards = document.getElementById("exposure-cards");
  exposureCards.innerHTML = exposureArms.length ? exposureArms.map(row => {
    const isTactical = String(row.arm_id || "").startsWith("tactical");
    const comparison = row.excess_vs_own_buy_hold;
    return `<article class="exposure-card ${isTactical ? "tactical" : "benchmark"}">
      <div class="exposure-card-head"><div><span>${isTactical ? "規則組" : "買入持有基準"}</span><h3>${esc(row.label)}</h3></div><b>${esc(row.asset_code)}</b></div>
      <div class="exposure-return"><span>歷史累積淨報酬</span><strong class="${returnTone(row.cumulative_net_return)}">${esc(percent(row.cumulative_net_return))}</strong></div>
      <dl><div><dt>同期買入持有</dt><dd class="${returnTone(row.buy_hold_return)}">${esc(percent(row.buy_hold_return))}</dd></div><div><dt>相對自己的基準</dt><dd class="${returnTone(comparison)}">${esc(percent(comparison))}</dd></div><div><dt>最大回撤</dt><dd>${esc(plainPercent(row.max_drawdown))}</dd></div><div><dt>交易／成本拖累</dt><dd>${esc(row.trade_count)} 次 · ${esc(plainPercent(row.transaction_cost_drag))}</dd></div></dl>
      <p>${esc(row.action_label)}</p><div class="exposure-reasons">${(row.reason_labels || []).map(reason => `<span>${esc(reason)}</span>`).join("")}</div>
    </article>`;
  }).join("") : `<p class="exposure-empty">尚未完成鎖定歷史閘門；不顯示假績效。</p>`;

  const experiment = data.experiment || {};
  const experimentStatusLabel = {
    not_registered: "規格尚未註冊", waiting_first_signal: "等待第一批新訊號",
    collecting: "前瞻觀察中", results_available: "已有到期結果",
    no_eligible: "今日無股票通過門檻", pending_next_open: "等待下個交易日開盤",
    database_unavailable: "P2帳本不可用", schema_unavailable: "P2結構未完成"
  }[experiment.status] || "狀態確認中";
  const openRows = [...(experiment.awaiting_entry || []), ...(experiment.open_trials || [])];
  const resultRows = experiment.settled_results || [];
  const scoreboard = experiment.scoreboard || [];
  document.getElementById("experiment-status").innerHTML = `
    <div class="experiment-copy"><span>v4 對照保留 · v${esc(experiment.strategy_version)} 強勢拉回組</span><strong>${esc(experimentStatusLabel)}</strong><p>${esc(experiment.message)}</p></div>
    <dl><div><dt>最近訊號日</dt><dd>${esc(experiment.latest_signal_date || "尚無")}</dd></div><div><dt>本批訊號</dt><dd>${esc((experiment.latest_signals || []).length)} 檔</dd></div><div><dt>等待／觀察</dt><dd>${esc(openRows.length)} 筆</dd></div><div><dt>已結算</dt><dd>${esc(resultRows.length)} 筆</dd></div></dl>
    <div class="scoreboard-mini">${scoreboard.length ? scoreboard.map(row => `<span><b>${esc(row.horizon_days)}日</b> n=${esc(row.observations)} · 正報酬 ${esc(plainPercent(row.hit_rate))} · 贏0050 ${esc(plainPercent(row.beat_rate))}</span>`).join("") : "尚無到期樣本；不顯示假勝率。"}</div>`;

  const renderLedgerRow = (row, result = false) => result ? `
    <div class="ledger-row"><div><strong>${esc(row.name)} <small>${esc(row.code)}</small></strong><span>訊號 ${esc(row.signal_date)} · ${esc(row.horizon_days)}日 · 出場 ${esc(row.exit_date)}</span></div><div class="ledger-metrics"><span class="${tone(row.net_return || 0)}">淨報酬 ${esc(percent(row.net_return))}</span><span class="${tone(row.alpha_return || 0)}">相對0050 ${esc(percent(row.alpha_return))}</span><b>${Number(row.alpha_return || 0) > 0 ? "贏0050" : "未贏0050"}</b></div></div>` : `
    <div class="ledger-row"><div><strong>${esc(row.name)} <small>${esc(row.code)}</small></strong><span>訊號 ${esc(row.signal_date)} · 排序 ${esc(row.signal_rank || "—")}</span></div><div class="ledger-metrics">${entryPerformanceHtml(row)}<b>${esc(row.horizon_days)}日觀察</b></div></div>`;
  document.getElementById("experiment-open").innerHTML = openRows.length
    ? openRows.map(row => renderLedgerRow(row)).join("")
    : `<p class="ledger-empty">目前沒有等待進場或觀察中的v5訊號。</p>`;
  document.getElementById("experiment-results").innerHTML = resultRows.length
    ? resultRows.map(row => renderLedgerRow(row, true)).join("")
    : `<p class="ledger-empty">尚未有訊號走完5日或20日；不以前測或舊版本補數。</p>`;

  const aiGroups = experiment.ai_groups || [];
  const aiGroupList = document.getElementById("ai-group-list");
  if (aiGroupList) {
    aiGroupList.innerHTML = aiGroups.length ? aiGroups.map(group => {
      const latest = group.latest_run || {};
      const trackingPicks = group.tracking_picks || [];
      const awaitingPicks = group.awaiting_latest_entry || [];
      const board = group.scoreboard || [];
      const state = latest.status === "success" ? "名單已凍結"
        : latest.status === "no_run" ? "本次未執行" : "等待首次排程";
      const renderAiPick = row => {
        const features = row.features || {};
        return `<li><span>${esc(row.signal_rank || "—")}</span><div><strong>${esc(row.name)} <small>${esc(row.code)}</small></strong><p>${esc(features.thesis || "理由已凍結於P2")}</p>${entryPerformanceHtml(row)}<em>信心 ${esc(plainPercent(features.confidence))} · 風險：${esc(features.risk || "見完整紀錄")}</em></div></li>`;
      };
      const trackingHtml = trackingPicks.length
        ? trackingPicks.map(renderAiPick).join("")
        : `<li class="ai-empty">尚無已建立模擬買入價的批次。</li>`;
      const awaitingHtml = awaitingPicks.length
        ? awaitingPicks.map(renderAiPick).join("") : "";
      const boardHtml = board.length ? board.map(row => `<span><b>${esc(row.horizon_days)}日</b> n=${esc(row.observations)} · 正報酬 ${esc(plainPercent(row.hit_rate))} · 贏0050 ${esc(plainPercent(row.beat_rate))}</span>`).join("") : "尚無到期樣本；不顯示假勝率。";
      return `<article class="ai-group-card ${esc(group.arm)}">
        <div class="ai-group-head"><div><p>${esc(group.arm === "database" ? "P2 DATABASE ONLY" : "PUBLIC WEB ONLY")}</p><h3>${esc(group.label)}</h3></div><span>${esc(state)}</span></div>
        <dl><div><dt>目前績效批次</dt><dd>${esc(group.tracking_signal_date || group.latest_signal_date || "尚無")}</dd></div><div><dt>成功／no_run／漏跑</dt><dd>${esc(group.successful_signal_days)} / ${esc(group.no_run_days)} / ${esc((group.missing_run_signal_dates || []).length)}</dd></div></dl>
        <p class="ai-batch-label">績效追蹤批次 · 訊號日 ${esc(group.tracking_signal_date || "尚無")}</p>
        ${latest.no_run_reason ? `<p class="ai-no-run">原因：${esc(latest.no_run_reason)}</p>` : ""}
        <ol class="ai-pick-list">${trackingHtml}</ol>
        ${awaitingPicks.length ? `<p class="ai-pending-entry">新選等待開盤批次 · 訊號日 ${esc(group.latest_signal_date)} · ${esc(awaitingPicks.length)} 檔</p><ol class="ai-pick-list awaiting">${awaitingHtml}</ol>` : ""}
        <div class="scoreboard-mini">${boardHtml}</div>
      </article>`;
    }).join("") : `<p class="ledger-empty">AI 協定已準備；尚未有獨立排程結果。</p>`;
  }

  const counts = data.decision_counts || {};
  const watchCount = Number(counts.watch || 0) + Number(counts.caution || 0);
  const decisionCards = [
    { label: "符合進場觀察區間", value: watchCount, note: `其中 ${integer(counts.caution)} 檔仍有其他風險`, tone: "positive" },
    { label: "已漲多，只等拉回", value: counts.no_chase || 0, note: "20日漲幅、月線乖離或當日漲幅過高", tone: "warning" },
    { label: "轉弱／價格排除", value: Number(counts.weakening || 0) + Number(counts.data_check || 0), note: "先等收盤重新計算", tone: "negative" },
    { label: "明確避免", value: (data.avoids || []).length, note: "反彈不視為翻多", tone: "negative" }
  ];
  document.getElementById("decision-strip").innerHTML = decisionCards.map(card => `
    <article class="decision-summary ${card.tone}">
      <span>${esc(card.label)}</span><strong>${esc(card.value)}</strong><small>${esc(card.note)}</small>
    </article>`).join("");

  const quoteHtml = row => {
    const quote = row.quote || {};
    return `<div class="quote-cell"><strong class="${tone(quote.change_pct || 0)}">${esc(price(quote.value))}</strong>
      <span class="${tone(quote.change_pct || 0)}">${esc(percent(quote.change_pct))}</span>
      <small>${esc(basisLabel(quote.price_basis))} · ${esc(quote.quote_at ? localTime(quote.quote_at).split(" ").pop() : "待更新")}</small></div>`;
  };
  const tagList = (values, className) => (values || []).length
    ? `<div class="tag-list">${values.map(value => `<span class="${className}">${esc(value)}</span>`).join("")}</div>`
    : `<span class="muted">無</span>`;

  const candidateRows = data.candidates || [];
  const candidateVisible = (row, filter) => {
    if (filter === "all") return true;
    if (filter === "watch") return ["watch", "caution"].includes(row.decision_key);
    if (filter === "no_chase") return row.decision_key === "no_chase";
    if (filter === "weakening") return ["weakening", "data_check", "waiting"].includes(row.decision_key);
    return true;
  };
  const renderCandidates = filter => {
    const rows = candidateRows.filter(row => candidateVisible(row, filter));
    document.getElementById("candidate-list").innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td><div class="stock-id"><b>${esc(row.research_rank)}</b><div><strong>${esc(row.name)}</strong><span>${esc(row.code)} · 訊號 ${esc(row.signal_date)}</span></div></div></td>
        <td><span class="decision-label ${decisionTone(row.decision_key)}">${esc(row.decision_label)}</span><small class="cell-note">${esc(row.decision_reason)}</small></td>
        <td>${quoteHtml(row)}</td>
        <td>${entryPerformanceHtml(row)}</td>
        <td><strong>${esc(row.evidence_passed)}/${esc(row.evidence_total)}</strong>${tagList(row.evidence_factors, "factor-tag")}</td>
        <td class="metric-cell ${tone(row.relative_20d)}"><strong>${esc(percent(row.relative_20d))}</strong><small>20日報酬 ${esc(percent(row.return_20d))}</small></td>
        <td class="metric-cell ${tone(row.revenue_yoy / 100)}"><strong>${esc(percent(row.revenue_yoy / 100))}</strong><small>營收分 ${esc(row.revenue_score)}/4</small></td>
        <td>${tagList(row.risk_flags, "risk-tag")}</td>
      </tr>`).join("") : `<tr><td colspan="8">目前沒有符合此分類的候選。</td></tr>`;

    document.getElementById("candidate-cards").innerHTML = rows.length ? rows.map(row => `
      <article class="decision-mobile-card">
        <div class="mobile-stock-head"><div><span>v${esc(row.strategy_version)} 凍結排序 ${esc(row.research_rank)} · ${esc(row.signal_date)}</span><h3>${esc(row.name)} <small>${esc(row.code)}</small></h3></div><span class="decision-label ${decisionTone(row.decision_key)}">${esc(row.decision_label)}</span></div>
        <p>${esc(row.decision_reason)}</p>
        <div class="mobile-performance">${entryPerformanceHtml(row)}</div>
        <div class="mobile-metrics"><div><span>盤中參考</span>${quoteHtml(row)}</div><div><span>相對0050（訊號日）</span><strong class="${tone(row.relative_20d)}">${esc(percent(row.relative_20d))}</strong></div><div><span>營收年增</span><strong>${esc(percent(row.revenue_yoy / 100))}</strong></div></div>
        <div class="mobile-evidence"><b>訊號日條件 ${esc(row.evidence_passed)}/${esc(row.evidence_total)}</b>${tagList(row.evidence_factors, "factor-tag")}</div>
        <div class="mobile-evidence"><b>風險</b>${tagList(row.risk_flags, "risk-tag")}</div>
      </article>`).join("") : `<p class="mobile-empty">今天沒有已凍結的新訊號；系統不會用即時排行榜補名單。</p>`;
  };
  renderCandidates("all");
  document.querySelectorAll(".candidate-filter").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".candidate-filter").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    renderCandidates(button.dataset.filter);
  }));

  const avoidRows = data.avoids || [];
  document.getElementById("avoid-list").innerHTML = avoidRows.map(row => `
    <tr>
      <td><div class="stock-id no-rank"><div><strong>${esc(row.name)}</strong><span>${esc(row.code)} · ${esc(row.industry)}</span></div></div></td>
      <td>${quoteHtml(row)}</td>
      <td><span class="decision-label negative">${esc(row.decision_label)}</span><small class="cell-note">${esc(row.avoid_reason)}</small></td>
      <td class="metric-cell ${tone(row.relative_20d)}"><strong>${esc(percent(row.relative_20d))}</strong><small>月線距離 ${esc(percent(row.distance_ma20))}</small></td>
      <td>${tagList(row.blockers, "risk-tag")}</td>
      <td><span class="history-note">${esc(row.history)}</span></td>
    </tr>`).join("");
  document.getElementById("avoid-cards").innerHTML = avoidRows.map(row => `
    <article class="decision-mobile-card avoid-card">
      <div class="mobile-stock-head"><div><span>避免清單</span><h3>${esc(row.name)} <small>${esc(row.code)}</small></h3></div><span class="decision-label negative">只觀察反彈</span></div>
      <div class="mobile-metrics"><div><span>盤中參考</span>${quoteHtml(row)}</div><div><span>相對0050</span><strong class="${tone(row.relative_20d)}">${esc(percent(row.relative_20d))}</strong></div></div>
      <div class="mobile-evidence"><b>未通過</b>${tagList(row.blockers, "risk-tag")}</div><p>${esc(row.history)}</p>
    </article>`).join("");

  const research = data.research_state || {};
  const auditBlocker = (research.audit_blockers || [])[0];
  document.getElementById("research-state").innerHTML = `
    <div><span>正式結論</span><strong>買進模型尚未通過</strong><p>${esc(research.summary)}${auditBlocker ? ` 研究審核限制：${esc(auditBlocker)}。` : ""}</p></div>
    <dl><div><dt>資料新鮮度</dt><dd>${research.data_status === "current" ? "正常" : esc(research.data_status)}</dd></div><div><dt>完成前瞻試驗</dt><dd>${esc(research.completed_trials)} 次</dd></div><div><dt>自動交易</dt><dd>${research.live_enabled ? "已啟用" : "未啟用"}</dd></div></dl>`;
  document.getElementById("rule-list").innerHTML = (data.research_rules || []).map(row => `
    <tr>
      <td><span class="rule-kind ${row.kind === "advantage" ? "positive" : "negative"}">${row.kind === "advantage" ? "優勢" : "避免"}</span><strong>${esc(row.label)}</strong></td>
      <td>${esc(row.use)}</td><td>${esc(row.horizon_days)} 日</td>
      <td class="${tone(row.up_rate - 0.5)}">${esc(plainPercent(row.up_rate))}</td>
      <td class="${tone(row.average_return)}">${esc(percent(row.average_return))}</td>
      <td class="${tone(row.average_alpha)}">${esc(percent(row.average_alpha))}</td>
      <td>${esc(plainPercent(row.beat_rate))}</td><td>${esc(integer(row.sample_size))}</td>
    </tr>`).join("");

  const expected = ["加權指數", "櫃買指數"];
  const indices = expected.map(name => data.indices.find(row => row.name === name) || { name });
  document.getElementById("index-strip").innerHTML = indices.map(row => `
    <div class="index-row"><div><span>${esc(row.name)}</span><strong>${esc(price(row.value))}</strong></div>
      <small>${row.quote_at ? `行情 ${esc(localTime(row.quote_at).split(" ").pop())}` : "開盤後更新"}</small>
      <span class="index-change ${tone(row.change_pct || 0)}">${esc(percent(row.change_pct))}</span></div>`).join("");

  const breadth = data.breadth || {};
  document.getElementById("breadth-score").innerHTML = `<div class="score-number">${esc(breadth.score)}<small>/100</small></div><div class="score-copy"><strong>${esc(breadth.status)}結構</strong><span>${esc(breadth.date)}，${esc(breadth.sample_size)} 個樣本。</span></div>`;
  const breadthBars = [["站上 20 日線", breadth.above_ma20], ["站上 60 日線", breadth.above_ma60], ["20 日勝過市場", breadth.beat_market_rate]];
  document.getElementById("breadth-bars").innerHTML = breadthBars.map(([label, value]) => `
    <div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(value || 0) * 100))}%"></span></div><strong>${esc(plainPercent(value))}</strong></div>`).join("");
  document.getElementById("overnight-list").innerHTML = data.overnight.map(row => `
    <div class="overnight-row"><strong>${esc(row.name)}</strong><time>${esc(row.date)}</time><span class="overnight-return ${tone(row.return)}">${esc(percent(row.return))}</span></div>`).join("");

  const riskObservation = data.risk_observation || {};
  const riskLatest = riskObservation.latest;
  const riskLabels = { normal: "一般", watch: "留意", high: "偏高" };
  const riskDisclosure = "7/17 暴跌不是本層的前瞻預測；本紀錄自 7/20 起累積，且不會改動任何選股結果。";
  if (!riskLatest) {
    document.getElementById("risk-observation").innerHTML = `
      <div class="risk-observation-head waiting"><strong>等待第一筆盤前紀錄</strong><span>起始日 ${esc(riskObservation.prospective_start_date || "2026-07-20")}</span></div>
      <p>${esc(riskDisclosure)}</p>`;
  } else if (!riskLatest.prospective) {
    document.getElementById("risk-observation").innerHTML = `
      <div class="risk-observation-head missing"><strong>本日不評級</strong><span>${esc(riskLatest.status)}</span></div>
      <p>資料缺漏或凍結時間已過 09:00，因此不產生風險等級，也不補寫結果。</p>
      <small>${esc(riskDisclosure)}</small>`;
  } else {
    const inputs = riskLatest.inputs || {};
    document.getElementById("risk-observation").innerHTML = `
      <div class="risk-observation-head ${esc(riskLatest.warning_level)}"><strong>${esc(riskLabels[riskLatest.warning_level] || riskLatest.warning_level)}</strong><span>${esc(riskLatest.risk_points)}/8 點 · ${esc(riskLatest.target_date)}</span></div>
      <dl><div><dt>廣度</dt><dd>${esc(inputs.breadth_score)}/100</dd></div><div><dt>站上月線</dt><dd>${esc(plainPercent(inputs.fraction_above_ma20))}</dd></div><div><dt>隔夜組合</dt><dd class="${tone(inputs.overnight_composite)}">${esc(percent(inputs.overnight_composite))}</dd></div><div><dt>20日波動</dt><dd>${esc(percent(inputs.realized_volatility_20d))}</dd></div></dl>
      <p>僅供預警學習，不是交易訊號、減碼指令或選股否決條件。</p>
      <small>${esc(riskDisclosure)}</small>`;
  }

  const renderSectors = filter => {
    let rows = data.sectors;
    if (filter === "strong") rows = rows.filter(row => row.status === "強");
    if (filter === "participation") rows = rows.filter(row => row.above_ma20 >= 0.55);
    document.getElementById("sector-list").innerHTML = rows.length ? rows.map(row => `
      <tr><td><strong>${esc(row.name)}</strong></td><td class="${tone(row.return_20d)}">${esc(percent(row.return_20d))}</td><td class="${tone(row.relative_20d)}">${esc(percent(row.relative_20d))}</td><td>${esc(plainPercent(row.above_ma20))}</td><td>${esc(row.sample_size)}</td><td><span class="structure-label">${esc(row.status)}</span></td></tr>`).join("") : `<tr><td colspan="6">目前沒有符合此條件的產業。</td></tr>`;
  };
  renderSectors("all");
  document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".filter-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    renderSectors(button.dataset.filter);
  }));

  document.getElementById("watchpoint-list").innerHTML = data.watchpoints.map(item => `<li>${esc(item)}</li>`).join("");
  document.getElementById("source-list").innerHTML = data.sources.map(source => `<div class="source-item">${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.name)}</a>` : `<strong>${esc(source.name)}</strong>`}<p>${esc(source.note)}${source.freshness ? ` · ${esc(source.freshness)}` : ""}</p></div>`).join("");
  document.getElementById("market-reload").addEventListener("click", () => window.location.reload());
})();
