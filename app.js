(function () {
  "use strict";

  var GATE_CANDLES = "https://api.gateio.ws/api/v4/spot/candlesticks";
  var GATE_TICKER = "https://api.gateio.ws/api/v4/spot/tickers";
  var PAIR = "BTC_USDT";
  var LIMIT = 120;
  var REFRESH_MS = 5000;
  var TZ = "Asia/Singapore";

  var interval = "1m";
  var chart = null;
  var series = null;
  var useFallback = false;
  var fitted = false;
  var timer = null;
  var lastCandleData = [];

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function asDate(time) {
    if (typeof time === "number") return new Date(time * 1000);
    if (time && typeof time === "object" && time.year) {
      return new Date(Date.UTC(time.year, time.month - 1, time.day));
    }
    var parsed = new Date(time);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatClock(date, withSeconds) {
    if (!date) return "--";
    var opts = {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    };
    if (withSeconds) opts.second = "2-digit";
    return new Intl.DateTimeFormat("zh-CN", opts).format(date);
  }

  function formatDateTime(time) {
    var date = asDate(time);
    if (!date) return "--";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: TZ,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function formatMaybeIso(value) {
    if (!value) return "";
    var date = asDate(typeof value === "number" ? value : String(value));
    return date ? formatDateTime(date.getTime() / 1000) : String(value);
  }

  function formatPrice(n) {
    var num = Number(n);
    if (!isFinite(num)) return "--";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  }

  function setLive(ok, text) {
    var badge = $("liveBadge");
    badge.classList.toggle("off", !ok);
    $("liveText").textContent = text;
  }

  function parseCandles(raw) {
    // Gate: [t, volume, close, high, low, open, amount, ...]
    var map = {};
    var list = [];
    (raw || []).forEach(function (row) {
      if (!row || row.length < 6) return;
      var candle = {
        time: Number(row[0]),
        close: parseFloat(row[2]),
        high: parseFloat(row[3]),
        low: parseFloat(row[4]),
        open: parseFloat(row[5])
      };
      if (!isFinite(candle.time) || !isFinite(candle.open) || !isFinite(candle.close)) return;
      map[candle.time] = candle;
    });
    Object.keys(map).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (key) {
      list.push(map[key]);
    });
    return list;
  }

  function chartOptions(el) {
    return {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: "solid", color: "#12161c" },
        textColor: "#848e9c",
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif'
      },
      grid: {
        vertLines: { color: "#1e2329" },
        horzLines: { color: "#1e2329" }
      },
      rightPriceScale: { borderColor: "#1e2329" },
      timeScale: {
        borderColor: "#1e2329",
        timeVisible: true,
        secondsVisible: false
      },
      localization: {
        locale: "zh-CN",
        timeFormatter: function (time) { return formatDateTime(time); },
        priceFormatter: function (price) { return formatPrice(price); }
      },
      handleScroll: { vertTouchDrag: false },
      crosshair: {
        vertLine: { color: "rgba(234,236,239,0.16)" },
        horzLine: { color: "rgba(234,236,239,0.16)" }
      }
    };
  }

  function initChart() {
    var el = $("chart");
    var canvas = $("fallbackChart");
    if (window.LightweightCharts && typeof LightweightCharts.createChart === "function") {
      chart = LightweightCharts.createChart(el, chartOptions(el));
      series = chart.addCandlestickSeries({
        upColor: "#0ecb81",
        downColor: "#f6465d",
        borderUpColor: "#0ecb81",
        borderDownColor: "#f6465d",
        wickUpColor: "#0ecb81",
        wickDownColor: "#f6465d"
      });
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(function () {
          if (!chart) return;
          chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        }).observe(el);
      }
      window.addEventListener("resize", function () {
        if (!chart) return;
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      });
    } else {
      useFallback = true;
      el.hidden = true;
      canvas.hidden = false;
      window.addEventListener("resize", function () {
        if (lastCandleData.length) drawFallback(lastCandleData);
      });
    }
  }

  function applyCandles(data, resetView) {
    lastCandleData = data;
    if (series) {
      series.setData(data);
      if (resetView || !fitted) {
        chart.timeScale().fitContent();
        fitted = true;
      }
    } else if (useFallback) {
      drawFallback(data);
    }
  }

  function drawFallback(data) {
    var canvas = $("fallbackChart");
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, width, height);
    if (!data.length) return;

    var pad = { top: 16, right: 56, bottom: 24, left: 8 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var highs = data.map(function (c) { return c.high; });
    var lows = data.map(function (c) { return c.low; });
    var min = Math.min.apply(null, lows);
    var max = Math.max.apply(null, highs);
    if (max === min) { max += 1; min -= 1; }
    var span = max - min;

    function yOf(price) {
      return pad.top + (max - price) / span * plotH;
    }

    ctx.strokeStyle = "#1e2329";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#848e9c";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    for (var i = 0; i < 4; i++) {
      var price = max - span * i / 3;
      var y = yOf(price);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(formatPrice(price), width - pad.right + 6, y + 4);
    }

    var gap = plotW / data.length;
    var bodyW = Math.max(1.5, gap * 0.62);
    data.forEach(function (c, idx) {
      var x = pad.left + gap * idx + gap / 2;
      var up = c.close >= c.open;
      ctx.strokeStyle = ctx.fillStyle = up ? "#0ecb81" : "#f6465d";
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.high));
      ctx.lineTo(x, yOf(c.low));
      ctx.stroke();
      var top = yOf(Math.max(c.open, c.close));
      var bot = yOf(Math.min(c.open, c.close));
      var h = Math.max(1, bot - top);
      ctx.fillRect(x - bodyW / 2, top, bodyW, h);
    });

    ctx.fillStyle = "#848e9c";
    ctx.textAlign = "center";
    var step = Math.max(1, Math.ceil(data.length / 4));
    for (var j = 0; j < data.length; j += step) {
      ctx.fillText(formatClock(asDate(data[j].time), false), pad.left + gap * j + gap / 2, height - 8);
    }
  }

  function renderTicker(ticker, lastClose) {
    var last = ticker && ticker.last != null ? ticker.last : lastClose;
    $("lastPrice").textContent = formatPrice(last);
    if (ticker) {
      var chg = parseFloat(ticker.change_percentage);
      var chgEl = $("changePct");
      if (isFinite(chg)) {
        var sign = chg > 0 ? "+" : "";
        chgEl.textContent = "24h " + sign + chg.toFixed(2) + "%";
        chgEl.className = "chg " + (chg > 0 ? "up" : chg < 0 ? "down" : "");
      }
      $("high24").textContent = formatPrice(ticker.high_24h);
      $("low24").textContent = formatPrice(ticker.low_24h);
    }
  }

  function renderStatus(data) {
    if (!data) return;
    var account = data.account || {};
    var focus = data.focus || {};
    $("spotUsdt").textContent = account.spotUsdt != null ? Number(account.spotUsdt).toFixed(2) + " USDT" : "--";
    $("loginState").textContent = account.loggedIn ? "已登录" : "未登录";
    $("botStatus").textContent = data.botStatus || "状态未知";
    $("accountNote").textContent = account.note || "";
    $("statusUpdated").textContent = data.updatedAt
      ? "同步 " + formatMaybeIso(data.updatedAt)
      : "刚刚同步";
    if (focus.market) $("eventTitle").textContent = focus.market === "BTC 5m Up/Down" ? "BTC 5分钟涨跌" : focus.market;
    if (focus.url) $("eventLink").href = focus.url;
    renderTrades(data.trades || []);
  }

  function renderTrades(trades) {
    var ul = $("tradeList");
    $("tradeCount").textContent = trades.length + " 条";
    ul.innerHTML = "";
    if (!trades.length) {
      ul.innerHTML = '<li class="empty">暂无交易记录。规则确定后，买卖操作会显示在这里。</li>';
      return;
    }
    trades.slice().reverse().forEach(function (trade) {
      var li = document.createElement("li");
      var action = trade.action || "";
      li.className = "trade";
      if (/跌/.test(action)) li.classList.add("down");
      else if (/涨|买入|买多/.test(action)) li.classList.add("up");
      li.innerHTML =
        '<div class="trade-top"><span class="action">' + escapeHtml(action) +
        '</span><span class="result">' + escapeHtml(trade.result || "") + "</span></div>" +
        '<div class="trade-mid"><span>' + escapeHtml(trade.amount || "") +
        "</span><span>价格 " + escapeHtml(trade.price || "--") + "</span></div>" +
        '<div class="trade-bot"><time>' + escapeHtml(formatMaybeIso(trade.time) || trade.time || "") +
        "</time>" + (trade.note ? '<span class="note">' + escapeHtml(trade.note) + "</span>" : "") +
        "</div>";
      ul.appendChild(li);
    });
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function loadMarket(resetView) {
    var candleUrl = GATE_CANDLES + "?currency_pair=" + PAIR + "&interval=" + interval + "&limit=" + LIMIT;
    var tickerUrl = GATE_TICKER + "?currency_pair=" + PAIR;
    return Promise.all([
      fetchJson(candleUrl),
      fetchJson(tickerUrl).catch(function () { return null; })
    ]).then(function (results) {
      var candles = parseCandles(results[0]);
      var ticker = results[1] && results[1][0] ? results[1][0] : null;
      applyCandles(candles, resetView);
      var last = candles.length ? candles[candles.length - 1].close : null;
      renderTicker(ticker, last);
      var label = interval === "1m" ? "1分钟" : "5分钟";
      $("chartMeta").textContent = label + " · " + candles.length + " 根 · " + formatClock(new Date(), true) + " 更新";
      setLive(true, "实时");
    }).catch(function (err) {
      console.error(err);
      setLive(false, "行情中断");
      $("chartMeta").textContent = "K 线加载失败，即将重试";
    });
  }

  function loadStatus() {
    return fetchJson("status.json?t=" + Date.now()).then(renderStatus).catch(function (err) {
      console.error(err);
      $("statusUpdated").textContent = "状态读取失败";
    });
  }

  function refreshAll(resetView) {
    return Promise.all([loadMarket(resetView), loadStatus()]);
  }

  function bindTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var next = tab.getAttribute("data-interval");
        if (next === interval) return;
        interval = next;
        fitted = false;
        tabs.forEach(function (other) {
          var on = other === tab;
          other.classList.toggle("active", on);
          other.setAttribute("aria-selected", on ? "true" : "false");
        });
        loadMarket(true);
      });
    });
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!document.hidden) refreshAll(false);
    }, REFRESH_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshAll(false);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (err) {
        console.warn("SW register failed", err);
      });
    });
  }

  initChart();
  bindTabs();
  refreshAll(true);
  startTimer();
})();
