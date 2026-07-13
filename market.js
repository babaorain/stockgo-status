(function () {
  "use strict";

  const data = window.STOCKGO_MARKET;
  if (!data) {
    document.getElementById("market-headline").textContent = "今日盤勢資料尚未產生";
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
  const number = value => value === null || value === undefined ? "開盤後更新" : new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(value);
  const localTime = value => value ? new Date(value).toLocaleString("zh-TW", {
    hour12: false, timeZone: "Asia/Taipei"
  }) : "—";
  const tone = value => value > 0.006 ? "positive" : value < -0.006 ? "negative" : "neutral";

  document.getElementById("market-phase").textContent = data.phase.label;
  document.getElementById("market-headline").textContent = data.headline;
  document.getElementById("market-summary").textContent = data.summary;
  document.getElementById("market-updated-at").textContent = `最後更新：${localTime(data.generated_at)}`;
  const quoteLabels = { current: "盤中指數已更新", waiting: "等待開盤或新撮合", unavailable: "官方來源暫時不可用" };
  document.getElementById("market-freshness").textContent = `${quoteLabels[data.quote_state] || "狀態確認中"}；上一完成盤：${text(data.latest_completed_session)}`;

  const expected = ["加權指數", "櫃買指數"];
  const indices = expected.map(name => data.indices.find(row => row.name === name) || { name });
  document.getElementById("index-strip").innerHTML = indices.map(row => `
    <div class="index-row">
      <div><span>${esc(row.name)}</span><strong>${number(row.value)}</strong></div>
      <small>${row.quote_at ? `行情時間 ${esc(localTime(row.quote_at))}` : `參考值 ${esc(number(row.reference))}`}</small>
      <span class="index-change ${tone(row.change_pct || 0)}">${percent(row.change_pct)}</span>
    </div>`).join("");

  const breadth = data.breadth || {};
  document.getElementById("breadth-score").innerHTML = `
    <div class="score-number">${esc(breadth.score)}<small>/100</small></div>
    <div class="score-copy"><strong>${esc(breadth.status)}結構</strong><span>${esc(breadth.date)}，涵蓋 ${esc(breadth.sample_size)} 個市場樣本。</span></div>`;
  const breadthBars = [
    ["站上 20 日線", breadth.above_ma20],
    ["站上 60 日線", breadth.above_ma60],
    ["20 日勝過市場", breadth.beat_market_rate]
  ];
  document.getElementById("breadth-bars").innerHTML = breadthBars.map(([label, value]) => `
    <div class="bar-row">
      <span>${esc(label)}</span>
      <div class="bar-track" role="img" aria-label="${esc(label)} ${esc(plainPercent(value))}"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(value || 0) * 100))}%"></span></div>
      <strong>${esc(plainPercent(value))}</strong>
    </div>`).join("");

  document.getElementById("overnight-list").innerHTML = data.overnight.map(row => `
    <div class="overnight-row">
      <strong>${esc(row.name)}</strong>
      <time>${esc(row.date)}</time>
      <span class="overnight-return ${tone(row.return)}">${esc(percent(row.return))}</span>
    </div>`).join("");

  const renderSectors = filter => {
    let rows = data.sectors;
    if (filter === "strong") rows = rows.filter(row => row.status === "強");
    if (filter === "participation") rows = rows.filter(row => row.above_ma20 >= 0.55);
    document.getElementById("sector-list").innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td><strong>${esc(row.name)}</strong></td>
        <td class="${tone(row.return_20d)}">${esc(percent(row.return_20d))}</td>
        <td class="${tone(row.relative_20d)}">${esc(percent(row.relative_20d))}</td>
        <td>${esc(plainPercent(row.above_ma20))}</td>
        <td>${esc(row.sample_size)}</td>
        <td><span class="structure-label">${esc(row.status)}</span></td>
      </tr>`).join("") : `<tr><td colspan="6">目前沒有符合此條件的產業。</td></tr>`;
  };
  renderSectors("all");
  document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".filter-button").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    renderSectors(button.dataset.filter);
  }));

  document.getElementById("analysis-list").innerHTML = data.analysis.map(item => `
    <article class="analysis-item ${esc(item.tone)}"><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></article>`).join("");
  document.getElementById("watchpoint-list").innerHTML = data.watchpoints.map(item => `<li>${esc(item)}</li>`).join("");
  document.getElementById("source-list").innerHTML = data.sources.map(source => `
    <div class="source-item">
      ${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.name)}</a>` : `<strong>${esc(source.name)}</strong>`}
      <p>${esc(source.note)}${source.freshness ? ` · ${esc(source.freshness)}` : ""}</p>
    </div>`).join("");

  document.getElementById("market-reload").addEventListener("click", () => window.location.reload());
})();
