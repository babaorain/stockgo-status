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
  const money = (value, signed = false) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    const number = Number(value);
    const sign = number < 0 ? "-" : signed && number > 0 ? "+" : "";
    return `${sign}NT$${integer(Math.abs(number))}`;
  };
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
    best_ask: "最佳委賣", open: "今日開盤", latest_close: "最近收盤",
    broker_snapshot: "券商截圖"
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

  const portfolio = data.personal_portfolio && typeof data.personal_portfolio === "object"
    ? data.personal_portfolio : {};
  const portfolioRows = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const portfolioSummary = document.getElementById("portfolio-summary");
  const portfolioBody = document.getElementById("portfolio-body");
  const portfolioCards = document.getElementById("portfolio-cards");
  const portfolioDisclosure = document.getElementById("portfolio-disclosure");
  const portfolioUpdatedAt = document.getElementById("portfolio-updated-at");
  if (portfolio.status !== "ready" || !portfolioRows.length) {
    portfolioSummary.innerHTML = `<article class="portfolio-empty"><strong>持股資料目前無法使用</strong><span>基準資料未通過完整性檢查，暫停顯示損益。</span></article>`;
    portfolioBody.innerHTML = `<tr><td colspan="7" class="comparison-empty">沒有可安全顯示的持股資料。</td></tr>`;
    portfolioCards.innerHTML = "";
    portfolioDisclosure.textContent = "持股基準異常時不使用猜測值計算損益。";
    portfolioUpdatedAt.textContent = "資料待修復";
  } else {
    const dayCoverageComplete = Number(portfolio.day_quote_coverage || 0) === portfolioRows.length;
    const summaryCards = [
      ["目前總市值", money(portfolio.market_value_twd), `${portfolioRows.length} 檔 · ${integer(portfolioRows.reduce((sum, row) => sum + Number(row.shares || 0), 0))} 股`, ""],
      ["未實現總損益", money(portfolio.unrealized_pnl_twd, true), `報酬率 ${percent(portfolio.total_return)}`, returnTone(portfolio.unrealized_pnl_twd)],
      ["今日損益", dayCoverageComplete ? money(portfolio.day_pnl_twd, true) : "報價未齊", dayCoverageComplete ? "依昨收與目前價格估算" : `已有 ${portfolio.day_quote_coverage || 0}/${portfolioRows.length} 檔當日報價`, returnTone(portfolio.day_pnl_twd)],
      ["成本基準", money(portfolio.cost_basis_twd), `來自 ${String(portfolio.baseline_as_of || "").slice(0, 10)} 券商截圖反推`, ""]
    ];
    portfolioSummary.innerHTML = summaryCards.map(([label, value, note, toneClass]) => `
      <article class="portfolio-metric"><span>${esc(label)}</span><strong class="${esc(toneClass)}">${esc(value)}</strong><small>${esc(note)}</small></article>`).join("");
    const rowHtml = row => `
      <tr>
        <td><strong>${esc(row.name)}</strong><small>${esc(row.code)} · ${esc(plainPercent(row.allocation))}</small></td>
        <td><strong>${esc(integer(row.shares))}</strong><small>股</small></td>
        <td><strong>${esc(price(row.average_cost))}</strong><small>${esc(money(row.cost_basis_twd))}</small></td>
        <td><strong>${esc(price(row.current_price))}</strong><small>${esc(basisLabel(row.current_price_basis))}</small></td>
        <td><strong>${esc(money(row.market_value_twd))}</strong></td>
        <td><strong class="${returnTone(row.unrealized_pnl_twd)}">${esc(money(row.unrealized_pnl_twd, true))}</strong><small class="${returnTone(row.total_return)}">${esc(percent(row.total_return))}</small></td>
        <td><strong class="${returnTone(row.day_pnl_twd)}">${row.day_pnl_twd === null || row.day_pnl_twd === undefined ? "—" : esc(money(row.day_pnl_twd, true))}</strong><small class="${returnTone(row.day_change_pct)}">${esc(percent(row.day_change_pct))}</small></td>
      </tr>`;
    portfolioBody.innerHTML = portfolioRows.map(rowHtml).join("");
    portfolioCards.innerHTML = portfolioRows.map(row => `
      <article class="portfolio-card">
        <header><div><h3>${esc(row.name)} <small>${esc(row.code)}</small></h3><span>${esc(integer(row.shares))} 股 · 配置 ${esc(plainPercent(row.allocation))}</span></div><strong>${esc(money(row.market_value_twd))}</strong></header>
        <dl><div><dt>成本均價</dt><dd>${esc(price(row.average_cost))}</dd></div><div><dt>目前價格</dt><dd>${esc(price(row.current_price))}</dd></div><div><dt>總損益</dt><dd class="${returnTone(row.unrealized_pnl_twd)}">${esc(money(row.unrealized_pnl_twd, true))}<small>${esc(percent(row.total_return))}</small></dd></div><div><dt>今日損益</dt><dd class="${returnTone(row.day_pnl_twd)}">${row.day_pnl_twd === null || row.day_pnl_twd === undefined ? "—" : esc(money(row.day_pnl_twd, true))}<small>${esc(percent(row.day_change_pct))}</small></dd></div></dl>
        <p>${esc(basisLabel(row.current_price_basis))} · ${esc(row.current_price_at || "時間待確認")}</p>
      </article>`).join("");
    portfolioUpdatedAt.textContent = `損益更新：${portfolio.latest_price_at ? localTime(portfolio.latest_price_at) : "等待行情"}`;
    portfolioDisclosure.textContent = `成本由 ${localTime(portfolio.baseline_as_of)} 券商截圖中的市值與未實現損益反推；目前損益＝目前市值－固定成本基準，未另估未來賣出費用，可能與券商顯示有小額差異。`;
  }

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
  const comparisonGroups = experiment.comparison_groups || [];
  const horizonDays = [5, 20, 60];
  const comparisonState = {
    group: "all",
    horizon: window.matchMedia("(max-width: 760px)").matches ? "5" : "all",
    state: "all",
    view: "overview",
    date: "all"
  };
  const outcomeFor = (row, horizon) => (row.horizons || {})[String(horizon)] || {
    settlement_status: horizon === 60 ? "not_started" : "unavailable"
  };
  const outcomeLabel = outcome => ({
    pending: "觀察中", settled: "已結算", unavailable: "資料不可用",
    not_started: "從下批開始"
  })[outcome.settlement_status] || "狀態待確認";
  const selectedHorizons = () => comparisonState.horizon === "all"
    ? horizonDays : [Number(comparisonState.horizon)];
  const finiteValues = (rows, getter) => rows.map(getter)
    .filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  const average = values => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const positionMatchesState = row => {
    if (comparisonState.state === "all") return true;
    const outcomes = selectedHorizons().map(horizon => outcomeFor(row, horizon));
    return comparisonState.state === "tracking"
      ? outcomes.some(outcome => outcome.settlement_status === "pending")
      : outcomes.some(outcome => outcome.settlement_status === "settled");
  };
  const aggregateHorizon = (rows, horizon) => {
    const outcomes = rows.map(row => outcomeFor(row, horizon));
    const settled = outcomes.filter(outcome => outcome.settlement_status === "settled");
    const pending = outcomes.filter(outcome => outcome.settlement_status === "pending");
    const unavailable = outcomes.filter(outcome => outcome.settlement_status === "unavailable");
    const notStarted = outcomes.filter(outcome => outcome.settlement_status === "not_started");
    const netReturns = finiteValues(settled, outcome => outcome.net_return);
    const benchmarks = finiteValues(settled, outcome => outcome.benchmark_return);
    const alphas = finiteValues(settled, outcome => outcome.alpha_return);
    const status = settled.length ? "results_available"
      : pending.length ? "collecting"
      : outcomes.length && outcomes.every(outcome => outcome.settlement_status === "not_started")
        ? "not_started" : "unavailable";
    return {
      horizon_days: horizon,
      status,
      total_rows: outcomes.length,
      observations: settled.length,
      pending: pending.length,
      unavailable: unavailable.length,
      not_started: notStarted.length,
      average_return: average(netReturns),
      average_benchmark: average(benchmarks),
      average_alpha: average(alphas),
      beat_rate: settled.length
        ? settled.filter(outcome => Number(outcome.alpha_return) > 0).length / settled.length : null
    };
  };
  const metricHtml = metric => {
    const observations = Number(metric.observations || 0);
    const pending = Number(metric.pending || 0);
    if (metric.status === "not_started") {
      return `<div class="horizon-metric empty"><span>n = 0</span><strong>從下批開始</strong><small>觀察中 0 · 已結算 0</small></div>`;
    }
    if (!observations) {
      return `<div class="horizon-metric waiting"><span>n = 0</span><strong>尚待到期</strong><small>觀察中 ${esc(pending)}${metric.not_started ? ` · 未啟動 ${esc(metric.not_started)}` : ""}</small></div>`;
    }
    return `<div class="horizon-metric"><span>n = ${esc(observations)}</span><strong class="${returnTone(metric.average_return)}">${esc(percent(metric.average_return))}</strong><em>同期0050 ${esc(percent(metric.average_benchmark))}</em><em class="${returnTone(metric.average_alpha)}">平均超額 ${esc(percent(metric.average_alpha))}</em><small>勝過0050 ${esc(plainPercent(metric.beat_rate))} · 觀察中 ${esc(pending)}</small></div>`;
  };
  const statusSummaryHtml = row => selectedHorizons().map(horizon => {
    const outcome = outcomeFor(row, horizon);
    const result = outcome.settlement_status === "settled"
      && outcome.net_return !== null && outcome.net_return !== undefined
      ? ` ${percent(outcome.net_return)}` : "";
    const progress = outcome.settlement_status === "pending"
      ? row.entry_date
        ? ` ${esc(outcome.sessions_elapsed || 0)}/${horizon}交易日`
        : " 等待進場"
      : "";
    return `<span><b>${horizon}日</b> ${esc(outcomeLabel(outcome))}${progress}${result ? `<i class="${returnTone(outcome.net_return)}">${esc(result)}</i>` : ""}</span>`;
  }).join("");
  const allPositions = comparisonGroups.flatMap(group => (group.positions || []).map(row => ({
    ...row, group_key: group.key, group_label: group.label
  })));
  const dateFilter = document.getElementById("signal-date-filter");
  const signalDates = [...new Set(allPositions.map(row => row.signal_date).filter(Boolean))].sort().reverse();
  dateFilter.innerHTML = `<option value="all">全部批次</option>${signalDates.map(date => `<option value="${esc(date)}">${esc(date)}</option>`).join("")}`;
  const syncButtons = (selector, key, attribute) => document.querySelectorAll(selector).forEach(button => {
    const active = button.dataset[attribute] === comparisonState[key];
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const filteredPositions = () => allPositions.filter(row =>
    (comparisonState.group === "all" || row.group_key === comparisonState.group)
    && (comparisonState.date === "all" || row.signal_date === comparisonState.date)
    && positionMatchesState(row)
  );
  const statCard = (label, value, note, toneClass = "") => `
    <article class="filter-stat ${toneClass}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
  const renderFilterStatistics = rows => {
    const enteredRows = rows.filter(row => row.entry_date && row.entry_price !== null && row.entry_price !== undefined);
    const currentReturns = finiteValues(enteredRows, row => row.return_since_entry);
    const currentAverage = average(currentReturns);
    const currentWinners = currentReturns.filter(value => value > 0).length;
    const cards = [
      statCard("篩選股票", integer(rows.length), `已進場 ${enteredRows.length} · 等待 ${rows.length - enteredRows.length}`),
      statCard(
        "截至目前平均報酬",
        currentAverage === null ? "尚無" : percent(currentAverage),
        currentReturns.length
          ? `等權平均 ${currentReturns.length} 檔 · 上漲 ${plainPercent(currentWinners / currentReturns.length)} · 未扣賣出成本`
          : "尚未建立模擬進場價",
        returnTone(currentAverage)
      )
    ];
    selectedHorizons().forEach(horizon => {
      const metric = aggregateHorizon(rows, horizon);
      const hasResults = metric.observations > 0;
      const value = hasResults ? percent(metric.average_return)
        : metric.status === "not_started" ? "尚未開始" : "尚待到期";
      const note = hasResults
        ? `n=${metric.observations} · 0050 ${percent(metric.average_benchmark)} · 超額 ${percent(metric.average_alpha)} · 勝過率 ${plainPercent(metric.beat_rate)} · 待 ${metric.pending}`
        : `已結算 0 · 觀察中 ${metric.pending}${metric.not_started ? ` · 未啟動 ${metric.not_started}` : ""}`;
      cards.push(statCard(`${horizon}交易日固定結果`, value, note, hasResults ? returnTone(metric.average_return) : "waiting"));
    });
    document.getElementById("filter-statistics").innerHTML = cards.join("");
  };
  const renderComparison = () => {
    const detailRows = filteredPositions().sort((a, b) => String(b.signal_date).localeCompare(String(a.signal_date))
      || Number(a.signal_rank || 999) - Number(b.signal_rank || 999)
      || String(a.code).localeCompare(String(b.code)));
    const groups = comparisonGroups.map(group => ({
      ...group,
      filtered_positions: detailRows.filter(row => row.group_key === group.key)
    })).filter(group => group.filtered_positions.length);
    document.querySelectorAll("[data-horizon-col]").forEach(cell => {
      cell.hidden = comparisonState.horizon !== "all" && cell.dataset.horizonCol !== comparisonState.horizon;
    });
    document.getElementById("strategy-comparison-body").innerHTML = groups.length ? groups.map(group => `
      <tr data-group="${esc(group.key)}">
        <th scope="row"><strong>${esc(group.label)}</strong><span>v${esc(group.strategy_version)}</span></th>
        ${(() => {
          const latestDate = [...new Set(group.filtered_positions.map(row => row.signal_date))].sort().reverse()[0] || null;
          const latestCount = group.filtered_positions.filter(row => row.signal_date === latestDate).length;
          return `<td><time>${esc(latestDate || "尚無")}</time><small>${esc(latestCount)} 檔 · 篩選共 ${esc(group.filtered_positions.length)} 檔</small></td>`;
        })()}
        ${(() => {
          const tracking = group.filtered_positions.filter(row => selectedHorizons().some(horizon => outcomeFor(row, horizon).settlement_status === "pending"));
          const awaiting = tracking.filter(row => !row.entry_date).length;
          const trackingNote = awaiting ? `其中 ${esc(awaiting)} 檔等待開盤`
            : tracking.length ? "選定期限觀察中" : "本篩選無觀察中";
          return `<td><strong>${esc(tracking.length)}</strong><small>${trackingNote}</small></td>`;
        })()}
        ${horizonDays.map(horizon => `<td data-horizon-col="${horizon}"${comparisonState.horizon !== "all" && comparisonState.horizon !== String(horizon) ? " hidden" : ""}>${metricHtml(aggregateHorizon(group.filtered_positions, horizon))}</td>`).join("")}
      </tr>`).join("") : `<tr><td colspan="6" class="comparison-empty">目前篩選條件沒有符合的策略組。</td></tr>`;
    const detailHtml = row => `<tr>
      <td><strong class="group-name">${esc(row.group_label)}</strong></td>
      <td><span class="stock-rank">${esc(row.signal_rank || "—")}</span><strong>${esc(row.name)}</strong><small>${esc(row.code)}</small></td>
      <td><time>${esc(row.signal_date)}</time></td>
      <td>${row.entry_price === null || row.entry_price === undefined ? `<span class="waiting-text">等待開盤</span>` : `<strong>${esc(price(row.entry_price))}</strong><small>${esc(row.entry_date)}</small>`}</td>
      <td>${row.return_since_entry === null || row.return_since_entry === undefined ? `<span class="waiting-text">尚未建立</span>` : `<strong class="${returnTone(row.return_since_entry)}">${esc(percent(row.return_since_entry))}</strong><small>${esc(price(row.current_price))}</small>`}</td>
      <td><div class="horizon-status-list">${statusSummaryHtml(row)}</div></td>
    </tr>`;
    document.getElementById("comparison-stock-body").innerHTML = detailRows.length
      ? detailRows.map(detailHtml).join("")
      : `<tr><td colspan="6" class="comparison-empty">這個批次與篩選條件目前沒有個股紀錄。</td></tr>`;
    document.getElementById("comparison-stock-cards").innerHTML = detailRows.length ? detailRows.map(row => `
      <article class="comparison-stock-card">
        <header><span>${esc(row.group_label)}</span><b>排序 ${esc(row.signal_rank || "—")}</b></header>
        <h3>${esc(row.name)} <small>${esc(row.code)}</small></h3>
        <dl><div><dt>訊號日</dt><dd>${esc(row.signal_date)}</dd></div><div><dt>模擬進場</dt><dd>${row.entry_price === null || row.entry_price === undefined ? "等待開盤" : esc(price(row.entry_price))}</dd></div><div><dt>目前報酬</dt><dd class="${returnTone(row.return_since_entry)}">${esc(percent(row.return_since_entry))}</dd></div></dl>
        <div class="horizon-status-list">${statusSummaryHtml(row)}</div>
      </article>`).join("") : `<p class="comparison-empty">這個批次與篩選條件目前沒有個股紀錄。</p>`;
    renderFilterStatistics(detailRows);
    document.getElementById("comparison-summary").textContent = `顯示 ${groups.length} 組策略、${detailRows.length} 檔訊號；批次 ${comparisonState.date === "all" ? "全部" : comparisonState.date}；${comparisonState.horizon === "all" ? "同時比較 5／20／60 交易日" : `聚焦 ${comparisonState.horizon} 交易日`}。下方統計只計算目前篩選出的股票。`;
    document.getElementById("comparison-overview").hidden = comparisonState.view !== "overview";
    document.getElementById("comparison-stocks").hidden = comparisonState.view !== "stocks";
  };
  syncButtons(".horizon-filter", "horizon", "horizon");
  renderComparison();
  [[".strategy-filter", "group", "group"], [".horizon-filter", "horizon", "horizon"], [".state-filter", "state", "state"], [".comparison-view", "view", "view"]].forEach(([selector, key, attribute]) => {
    document.querySelectorAll(selector).forEach(button => button.addEventListener("click", () => {
      comparisonState[key] = button.dataset[attribute];
      syncButtons(selector, key, attribute);
      renderComparison();
    }));
  });
  dateFilter.addEventListener("change", () => {
    comparisonState.date = dateFilter.value;
    renderComparison();
  });

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

  if (document.getElementById("candidate-list")) {
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
  }

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
