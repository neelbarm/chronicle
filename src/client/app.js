/* chronicle — report runtime.
   Vanilla JS, no dependencies, no network. Everything here draws from the JSON
   blob embedded above by the CLI. */
(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('chronicle-data').textContent);
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function num(n) {
    if (n == null || !isFinite(n)) return '0';
    return Math.round(n).toLocaleString('en-US');
  }
  function compact(n) {
    if (n == null || !isFinite(n)) return '0';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
    return num(n);
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  function fmtShort(ts) {
    var d = new Date(ts);
    return MONTHS[d.getUTCMonth()] + " '" + String(d.getUTCFullYear()).slice(2);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(c1, c2, t) {
    t = clamp(t, 0, 1);
    return 'rgb(' + Math.round(c1[0] + (c2[0] - c1[0]) * t) + ',' +
      Math.round(c1[1] + (c2[1] - c1[1]) * t) + ',' +
      Math.round(c1[2] + (c2[2] - c1[2]) * t) + ')';
  }
  /* Inline-markdown for narratives: `code` only, everything else escaped. */
  function richText(node, text) {
    node.textContent = '';
    var parts = String(text == null ? '' : text).split('`');
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1 && parts[i]) node.appendChild(el('code', null, parts[i]));
      else if (parts[i]) node.appendChild(document.createTextNode(parts[i]));
    }
  }

  var COOL = [43, 53, 80], MID = [91, 140, 255], HOT = [255, 84, 112];
  function churnColor(t) {
    return t < 0.5 ? mix(COOL, MID, t * 2) : mix(MID, HOT, (t - 0.5) * 2);
  }
  var HEAT0 = [18, 22, 34], HEAT1 = [56, 96, 200], HEAT2 = [124, 214, 255];
  function heatColor(t) {
    return t < 0.6 ? mix(HEAT0, HEAT1, t / 0.6) : mix(HEAT1, HEAT2, (t - 0.6) / 0.4);
  }

  var LANG_COLORS = {
    TypeScript: '#4f8cff', JavaScript: '#f0c14b', Python: '#3fb27f', Go: '#4fd1e0', Rust: '#f2803c',
    Java: '#e3703a', Kotlin: '#9b6bff', Swift: '#ff6b5e', 'C++': '#7b8cff', C: '#8d99b4', 'C#': '#6fbf73',
    Ruby: '#e14f5e', PHP: '#7a7fd1', HTML: '#ff7a59', CSS: '#4fb4ff', Vue: '#41b883', Svelte: '#ff5a3c',
    Shell: '#9ad14b', SQL: '#d68fff', Config: '#6b7690', Docs: '#b7c0d4', Markup: '#8fa2c8',
    Docker: '#3d8fe0', Terraform: '#a56bff', Build: '#c0a06a', Data: '#59c2a6', Notebook: '#f08c3a',
    Other: '#5a6478'
  };
  function langColor(name) {
    if (LANG_COLORS[name]) return LANG_COLORS[name];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ' 62% 58%)';
  }

  var ERA_COLORS = ['#5b8cff', '#9d6bff', '#37d0c0', '#ff8a4c', '#ff5470', '#4fb4ff', '#9ad14b', '#d68fff'];
  function eraColor(i) { return ERA_COLORS[i % ERA_COLORS.length]; }

  var authorColorMap = {};
  (DATA.authors || []).forEach(function (a) { authorColorMap[a.name] = a.color; });
  function authorColor(name) { return authorColorMap[name] || '#7c879e'; }

  /* --------------------------------------------------------------- tooltip */
  var tipEl = $('tooltip');
  var tipRaf = null, tipX = 0, tipY = 0;
  function tipMove(ev) {
    tipX = ev.clientX; tipY = ev.clientY;
    if (tipRaf) return;
    tipRaf = requestAnimationFrame(function () {
      tipRaf = null;
      var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      var x = tipX + 16, y = tipY + 16;
      if (x + w > window.innerWidth - 12) x = tipX - w - 16;
      if (y + h > window.innerHeight - 12) y = tipY - h - 16;
      tipEl.style.transform = 'translate3d(' + Math.max(8, x) + 'px,' + Math.max(8, y) + 'px,0) scale(1)';
    });
  }
  function tipShow(html, ev) {
    tipEl.innerHTML = html;
    tipEl.classList.add('show');
    tipMove(ev);
  }
  function tipHide() { tipEl.classList.remove('show'); }
  function ttRow(k, v) {
    return '<div class="tt-row"><span>' + k + '</span><span>' + v + '</span></div>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function bindTip(node, builder) {
    node.addEventListener('mouseenter', function (e) { tipShow(builder(), e); });
    node.addEventListener('mousemove', tipMove);
    node.addEventListener('mouseleave', tipHide);
  }

  /* --------------------------------------------------------------- reveals */
  var onVisible = [];
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
      var fn = entry.target.__onIn;
      if (fn) { entry.target.__onIn = null; fn(); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  function observe(node, fn) {
    if (fn) node.__onIn = fn;
    if (REDUCED) {
      node.classList.add('in');
      if (fn) { node.__onIn = null; fn(); }
      return;
    }
    revealObserver.observe(node);
  }
  function revealAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (n) {
      if (!n.classList.contains('in')) observe(n, n.__onIn || null);
    });
    onVisible.forEach(function (f) { f(); });
  }

  /* -------------------------------------------------------------- nav/chrome */
  (function nav() {
    var topnav = $('topnav'), bar = $('progressBar');
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
    var sections = links.map(function (l) { return $(l.getAttribute('data-nav')); });
    var ticking = false;
    function update() {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      var max = Math.max(1, document.body.scrollHeight - window.innerHeight);
      bar.style.width = clamp((y / max) * 100, 0, 100).toFixed(2) + '%';
      topnav.classList.toggle('visible', y > window.innerHeight * 0.55);
      var active = -1;
      for (var i = 0; i < sections.length; i++) {
        if (sections[i] && sections[i].getBoundingClientRect().top <= window.innerHeight * 0.4) active = i;
      }
      links.forEach(function (l, i) { l.classList.toggle('active', i === active); });
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  /* ------------------------------------------------------------------- hero */
  (function hero() {
    var h = DATA.hero;
    $('heroDates').textContent = fmtDate(h.firstTs) + '  —  ' + fmtDate(h.lastTs);
    richText($('heroSummary'), DATA.summary);

    var stats = [
      { v: h.commits, label: 'commits' },
      { v: h.authors, label: h.authors === 1 ? 'author' : 'authors' },
      { v: h.loc, label: 'lines today', compact: true },
      { v: h.files, label: 'files' },
      { v: h.activeDays, label: 'active days' },
      { v: h.longestStreak.days, label: 'day streak' },
      { v: h.linesAdded + h.linesRemoved, label: 'lines churned', compact: true },
      { v: h.busFactor, label: 'bus factor' }
    ];
    var wrap = $('heroStats');
    stats.forEach(function (s, i) {
      var card = el('div', 'stat');
      var b = el('b', null, '0');
      card.appendChild(b);
      card.appendChild(el('span', null, s.label));
      wrap.appendChild(card);
      var target = s.v || 0;
      var render = function (v) { b.textContent = s.compact ? compact(v) : num(v); };
      if (REDUCED) { card.classList.add('in'); render(target); return; }
      setTimeout(function () {
        card.classList.add('in');
        var t0 = performance.now(), dur = 1100 + i * 40;
        (function step(now) {
          var p = clamp((now - t0) / dur, 0, 1);
          var e = 1 - Math.pow(1 - p, 4);
          render(target * e);
          if (p < 1) requestAnimationFrame(step);
          else render(target);
        })(t0);
      }, 260 + i * 70);
    });
  })();

  /* ------------------------------------------------------------------- eras */
  (function eras() {
    var list = DATA.eras || [];
    var band = $('eraBand'), cards = $('eraCards'), story = $('story');
    if (!list.length) {
      band.style.display = 'none';
      return;
    }
    var t0 = list[0].startTs, t1 = list[list.length - 1].endTs;
    var span = Math.max(1, t1 - t0);

    list.forEach(function (era, i) {
      var pct = Math.max(6, ((era.endTs - era.startTs) / span) * 100);
      var seg = el('div', 'era-seg');
      seg.style.flexBasis = '0%';
      seg.style.flexGrow = '0';
      var fill = el('i');
      fill.style.background = 'linear-gradient(160deg,' + eraColor(i) + ' 0%, rgba(10,12,18,0.55) 150%)';
      seg.appendChild(fill);
      seg.appendChild(el('em', null, era.label || 'Era ' + (i + 1)));
      var u = el('u', null, fmtShort(era.startTs) + ' – ' + fmtShort(era.endTs) + ' · ' + num(era.commits) + ' commits');
      seg.appendChild(u);
      bindTip(seg, function () {
        return '<span class="tt-title">' + esc(era.label) + '</span>' +
          ttRow('Range', fmtDate(era.startTs) + ' – ' + fmtDate(era.endTs)) +
          ttRow('Commits', num(era.commits) + ' (' + era.commitsPerWeek + '/wk)') +
          ttRow('Lines', '+' + compact(era.added) + ' / -' + compact(era.removed)) +
          ttRow('Top directory', esc(era.dirs[0] ? era.dirs[0].name : '—'));
      });
      seg.addEventListener('click', function () {
        var target = document.getElementById('story-era-' + i);
        if (target) target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
      });
      band.appendChild(seg);
      setTimeout(function () { seg.style.flexBasis = pct + '%'; }, REDUCED ? 0 : 160 + i * 90);

      /* card */
      var card = el('div', 'era-card reveal');
      var rule = el('div', 'era-rule');
      rule.style.background = 'linear-gradient(90deg,' + eraColor(i) + ', rgba(255,255,255,0.08))';
      card.appendChild(rule);
      card.appendChild(el('h4', null, era.label || 'Era ' + (i + 1)));
      card.appendChild(el('p', 'era-range', fmtDate(era.startTs) + ' – ' + fmtDate(era.endTs)));
      var dl = el('dl');
      function row(k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
      row('Commits', num(era.commits) + '  ·  ' + era.commitsPerWeek + '/week');
      row('Lines', '+' + num(era.added) + ' / -' + num(era.removed));
      row('People', era.authors.slice(0, 3).map(function (a) { return a.name; }).join(', ') || '—');
      row('Focus', era.dirs.slice(0, 3).map(function (d) { return d.name; }).join(', ') || '—');
      row('Hot file', era.files[0] ? era.files[0].path : '—');
      card.appendChild(dl);
      cards.appendChild(card);
      observe(card);

      /* story block */
      var block = el('div', 'story-era reveal');
      block.id = 'story-era-' + i;
      var srule = el('div', 'story-rule');
      srule.style.background = eraColor(i);
      block.appendChild(srule);
      block.appendChild(el('h4', null, era.label || 'Era ' + (i + 1)));
      block.appendChild(el('p', 'era-range', fmtDate(era.startTs) + ' – ' + fmtDate(era.endTs) +
        '  ·  ' + num(era.commits) + ' commits  ·  ' + era.authors.length +
        (era.authors.length === 1 ? ' contributor' : ' contributors')));
      var p = el('p');
      richText(p, era.narrative);
      block.appendChild(p);
      story.appendChild(block);
      observe(block);
    });
  })();

  /* ---------------------------------------------------------------- heatmap */
  (function heatmap() {
    var host = $('heatmap');
    var heat = DATA.rhythm.heat, max = Math.max(1, DATA.rhythm.maxHeat);
    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var padL = 38, padT = 20, cw = 26, ch = 24, gap = 3;
    var W = padL + 24 * cw, H = padT + 7 * ch + 14;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMinYMid meet' });
    s.style.width = '100%';
    s.style.height = 'auto';
    for (var h = 0; h < 24; h += 3) {
      var lbl = svg('text', { x: padL + h * cw + 1, y: 12, class: 'axis-label' });
      lbl.textContent = (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p');
      s.appendChild(lbl);
    }
    var cells = [];
    for (var d = 0; d < 7; d++) {
      var dl = svg('text', { x: 0, y: padT + d * ch + 16, class: 'axis-label' });
      dl.textContent = days[d];
      s.appendChild(dl);
      for (var hh = 0; hh < 24; hh++) {
        var v = (heat[d] && heat[d][hh]) || 0;
        var t = v === 0 ? 0 : 0.12 + 0.88 * Math.pow(v / max, 0.55);
        var r = svg('rect', {
          x: padL + hh * cw, y: padT + d * ch, width: cw - gap, height: ch - gap,
          fill: v === 0 ? 'rgba(255,255,255,0.035)' : heatColor(t), class: 'hm-cell'
        });
        (function (rect, day, hour, val) {
          bindTip(rect, function () {
            return '<span class="tt-title">' + days[day] + ', ' +
              (hour % 12 === 0 ? 12 : hour % 12) + (hour < 12 ? 'am' : 'pm') + '</span>' +
              ttRow('Commits', num(val));
          });
        })(r, d, hh, v);
        s.appendChild(r);
        cells.push(r);
      }
    }
    host.appendChild(s);
    observe(host.parentNode.parentNode, function () {
      cells.forEach(function (c, i) {
        var row = Math.floor(i / 24), col = i % 24;
        setTimeout(function () { c.classList.add('in'); }, REDUCED ? 0 : (col * 11 + row * 26));
      });
    });
  })();

  /* ----------------------------------------------------- area / line charts */
  function areaChart(host, points, opts) {
    opts = opts || {};
    var W = 900, H = opts.height || 260, padL = 46, padR = 14, padT = 14, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, preserveAspectRatio: 'none' });
    var maxV = 0;
    points.forEach(function (p) { if (p.v > maxV) maxV = p.v; });
    maxV = Math.max(1, maxV);
    var n = points.length;
    var x = function (i) { return padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var y = function (v) { return padT + ih - (v / maxV) * ih; };

    for (var g = 0; g <= 4; g++) {
      var gy = padT + (g / 4) * ih;
      s.appendChild(svg('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, class: 'grid-line' }));
      var t = svg('text', { x: 6, y: gy + 3.5, class: 'axis-label' });
      t.textContent = compact(maxV * (1 - g / 4));
      s.appendChild(t);
    }

    var dTop = '', dArea = '';
    for (var i = 0; i < n; i++) {
      dTop += (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(points[i].v).toFixed(2) + ' ';
    }
    dArea = dTop + 'L' + x(n - 1).toFixed(2) + ' ' + (padT + ih) + ' L' + x(0).toFixed(2) + ' ' + (padT + ih) + ' Z';

    var gradId = 'grad-' + Math.random().toString(36).slice(2, 8);
    var defs = svg('defs');
    var lg = svg('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    var st1 = svg('stop', { offset: '0%', 'stop-color': opts.color || '#5b8cff', 'stop-opacity': '0.55' });
    var st2 = svg('stop', { offset: '100%', 'stop-color': opts.color || '#5b8cff', 'stop-opacity': '0.02' });
    lg.appendChild(st1); lg.appendChild(st2); defs.appendChild(lg); s.appendChild(defs);

    var grow = svg('g', {});
    grow.style.transformOrigin = '0px ' + (padT + ih) + 'px';
    if (!REDUCED) {
      grow.style.transform = 'scaleY(0.02)';
      grow.style.transition = 'transform 1.25s cubic-bezier(0.22,1,0.36,1)';
    }
    grow.appendChild(svg('path', { d: dArea, fill: 'url(#' + gradId + ')' }));
    grow.appendChild(svg('path', {
      d: dTop, fill: 'none', stroke: opts.color || '#5b8cff', 'stroke-width': '2',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));
    s.appendChild(grow);

    /* x labels */
    var ticks = Math.min(6, n);
    for (var k = 0; k < ticks; k++) {
      var idx = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1));
      var tx = svg('text', { x: x(idx), y: H - 6, class: 'axis-label', 'text-anchor': k === 0 ? 'start' : (k === ticks - 1 ? 'end' : 'middle') });
      tx.textContent = points[idx].label;
      s.appendChild(tx);
    }

    /* hover */
    var marker = svg('line', { y1: padT, y2: padT + ih, class: 'grid-line', stroke: 'rgba(255,255,255,0.35)', opacity: '0' });
    s.appendChild(marker);
    var dot = svg('circle', { r: 4, fill: opts.color || '#5b8cff', stroke: '#0a0c12', 'stroke-width': '2', opacity: '0' });
    s.appendChild(dot);
    var hit = svg('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent' });
    s.appendChild(hit);
    hit.addEventListener('mousemove', function (ev) {
      var box = s.getBoundingClientRect();
      var rel = ((ev.clientX - box.left) / box.width) * W;
      var i = n <= 1 ? 0 : Math.round(((rel - padL) / iw) * (n - 1));
      i = clamp(i, 0, n - 1);
      var p = points[i];
      marker.setAttribute('x1', x(i)); marker.setAttribute('x2', x(i));
      marker.setAttribute('opacity', '1');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.v));
      dot.setAttribute('opacity', '1');
      tipShow('<span class="tt-title">' + esc(p.title) + '</span>' + p.tip, ev);
    });
    hit.addEventListener('mouseleave', function () {
      marker.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); tipHide();
    });

    host.appendChild(s);
    return function play() { grow.style.transform = 'scaleY(1)'; };
  }

  (function velocity() {
    var host = $('velocityChart');
    var weeks = DATA.rhythm.weeks || [];
    if (!weeks.length) { host.appendChild(el('p', 'lede', 'No commits in range.')); return; }
    var pts = weeks.map(function (w) {
      return {
        v: w.commits,
        label: fmtShort(w.t),
        title: 'Week of ' + fmtDate(w.t),
        tip: ttRow('Commits', num(w.commits)) + ttRow('Lines', '+' + compact(w.added) + ' / -' + compact(w.removed))
      };
    });
    if (pts.length === 1) pts = [pts[0], pts[0]];
    var play = areaChart(host, pts, { color: '#5b8cff', height: 260 });
    observe(host.parentNode, play);
  })();

  /* ------------------------------------------------------------ growth area */
  (function growth() {
    var host = $('growthChart'), legend = $('growthLegend');
    var langs = DATA.growth.languages || [], rows = (DATA.growth.series || []).slice();
    // One week of history still deserves a readable band rather than a hairline.
    if (rows.length === 1) rows = [rows[0], rows[0]];
    if (!langs.length || !rows.length) { host.appendChild(el('p', 'lede', 'Not enough diff data to chart growth.')); return; }

    var W = 900, H = 320, padL = 50, padR = 14, padT = 14, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var n = rows.length;
    var totals = rows.map(function (r) {
      var t = 0;
      for (var i = 1; i < r.length; i++) t += r[i];
      return t;
    });
    var maxV = Math.max(1, Math.max.apply(null, totals));
    var x = function (i) { return padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var y = function (v) { return padT + ih - (v / maxV) * ih; };

    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, preserveAspectRatio: 'none' });
    for (var g = 0; g <= 4; g++) {
      var gy = padT + (g / 4) * ih;
      s.appendChild(svg('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, class: 'grid-line' }));
      var t = svg('text', { x: 6, y: gy + 3.5, class: 'axis-label' });
      t.textContent = compact(maxV * (1 - g / 4));
      s.appendChild(t);
    }

    /* era bands behind the chart */
    (DATA.eras || []).forEach(function (era, ei) {
      var i0 = 0, i1 = n - 1;
      for (var i = 0; i < n; i++) { if (rows[i][0] <= era.startTs) i0 = i; }
      for (var j = n - 1; j >= 0; j--) { if (rows[j][0] >= era.endTs) i1 = j; }
      if (i1 <= i0) i1 = Math.min(n - 1, i0 + 1);
      var rx = x(i0), rw = Math.max(2, x(i1) - x(i0));
      var band = svg('rect', { x: rx, y: padT, width: rw, height: ih, fill: eraColor(ei), opacity: '0.07' });
      s.appendChild(band);
      var lab = svg('text', { x: rx + 5, y: padT + 12, class: 'axis-label', fill: eraColor(ei) });
      lab.textContent = era.label;
      s.appendChild(lab);
    });

    var layers = [];
    var base = new Array(n).fill(0);
    for (var li = langs.length - 1; li >= 0; li--) {
      var upper = base.map(function (b, i) { return b + rows[i][li + 1]; });
      var d = '';
      for (var i2 = 0; i2 < n; i2++) d += (i2 ? 'L' : 'M') + x(i2).toFixed(2) + ' ' + y(upper[i2]).toFixed(2) + ' ';
      for (var i3 = n - 1; i3 >= 0; i3--) d += 'L' + x(i3).toFixed(2) + ' ' + y(base[i3]).toFixed(2) + ' ';
      d += 'Z';
      layers.push({ d: d, idx: li });
      base = upper;
    }
    var grow = svg('g', {});
    grow.style.transformOrigin = '0px ' + (padT + ih) + 'px';
    if (!REDUCED) {
      grow.style.transform = 'scaleY(0.02)';
      grow.style.transition = 'transform 1.4s cubic-bezier(0.22,1,0.36,1)';
    }
    layers.forEach(function (layer) {
      var p = svg('path', {
        d: layer.d, fill: langColor(langs[layer.idx]), opacity: '0.82',
        stroke: 'rgba(7,8,12,0.55)', 'stroke-width': '0.6'
      });
      grow.appendChild(p);
    });
    s.appendChild(grow);

    var ticks = Math.min(6, n);
    for (var k = 0; k < ticks; k++) {
      var idx = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1));
      var tx = svg('text', { x: x(idx), y: H - 6, class: 'axis-label', 'text-anchor': k === 0 ? 'start' : (k === ticks - 1 ? 'end' : 'middle') });
      tx.textContent = fmtShort(rows[idx][0]);
      s.appendChild(tx);
    }

    var marker = svg('line', { y1: padT, y2: padT + ih, stroke: 'rgba(255,255,255,0.35)', opacity: '0' });
    s.appendChild(marker);
    var hit = svg('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent' });
    s.appendChild(hit);
    hit.addEventListener('mousemove', function (ev) {
      var box = s.getBoundingClientRect();
      var rel = ((ev.clientX - box.left) / box.width) * W;
      var i = n <= 1 ? 0 : Math.round(((rel - padL) / iw) * (n - 1));
      i = clamp(i, 0, n - 1);
      marker.setAttribute('x1', x(i)); marker.setAttribute('x2', x(i)); marker.setAttribute('opacity', '1');
      var html = '<span class="tt-title">Week of ' + fmtDate(rows[i][0]) + '</span>' + ttRow('Total', num(totals[i]) + ' lines');
      langs.forEach(function (lang, li2) {
        if (rows[i][li2 + 1] > 0) html += ttRow('<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:' +
          langColor(lang) + '"></i>' + esc(lang), num(rows[i][li2 + 1]));
      });
      tipShow(html, ev);
    });
    hit.addEventListener('mouseleave', function () { marker.setAttribute('opacity', '0'); tipHide(); });

    host.appendChild(s);
    langs.forEach(function (lang) {
      var item = el('span', null);
      var i = el('i');
      i.style.background = langColor(lang);
      item.appendChild(i);
      item.appendChild(el('b', null, lang));
      legend.appendChild(item);
    });
    observe(host.parentNode, function () { grow.style.transform = 'scaleY(1)'; });
  })();

  /* --------------------------------------------------------------- treemap */
  (function treemap() {
    var host = $('treemap'), crumbs = $('treemapCrumbs'), scale = $('churnScale');
    var layouts = DATA.hotspots.layouts || {};
    var maxChurn = Math.max(1, DATA.hotspots.maxChurn);
    var logMax = Math.log(maxChurn + 1);
    var current = '';
    var played = false;

    if (!layouts['']) {
      host.appendChild(el('p', 'lede', 'No tracked text files found at HEAD.'));
      return;
    }

    var lo = el('span', null, 'rarely changed');
    var bar = el('span', 'bar');
    bar.style.background = 'linear-gradient(90deg,' + churnColor(0) + ',' + churnColor(0.5) + ',' + churnColor(1) + ')';
    var hi = el('span', null, num(maxChurn) + ' commits per file');
    scale.appendChild(lo); scale.appendChild(bar); scale.appendChild(hi);

    function draw(path, animate) {
      var rects = layouts[path] || [];
      host.textContent = '';
      var W = host.clientWidth || 800, H = host.clientHeight || 480;
      rects.forEach(function (r, i) {
        var tile = el('div', 'tm-tile' + (r.isDir ? ' dir' : ''));
        var w = r.w * W, h = r.h * H;
        tile.style.left = (r.x * W).toFixed(2) + 'px';
        tile.style.top = (r.y * H).toFixed(2) + 'px';
        tile.style.width = Math.max(0, w - 1).toFixed(2) + 'px';
        tile.style.height = Math.max(0, h - 1).toFixed(2) + 'px';
        var t = Math.log((r.heat == null ? r.churn : r.heat) + 1) / logMax;
        tile.style.background = churnColor(t);
        if (w > 46 && h > 20) {
          var label = el('span', null, r.name.length > 46 ? r.name.slice(0, 44) + '…' : r.name);
          tile.appendChild(label);
        }
        bindTip(tile, function () {
          var html = '<span class="tt-title">' + esc(r.path.indexOf(' ') >= 0 ? r.name : (r.path || '/')) + '</span>' +
            ttRow('Lines today', num(r.loc)) +
            ttRow(r.isDir ? 'Commits (subtree)' : 'Commits', num(r.churn)) +
            (r.isDir ? ttRow('Commits per file', num(r.heat)) : '');
          if (!r.isDir) {
            html += ttRow('Lines +/-', '+' + num(r.added) + ' / -' + num(r.removed));
            if (r.topAuthor) html += ttRow('Top author', esc(r.topAuthor));
            if (r.language) html += ttRow('Language', esc(r.language));
          } else if (r.childCount) {
            html += ttRow('Files', num(r.childCount)) + '<div class="tt-row"><span>Click to zoom</span><span></span></div>';
          }
          return html;
        });
        if (r.isDir && layouts[r.path]) {
          tile.addEventListener('click', function () { setPath(r.path); });
        }
        host.appendChild(tile);
        if (!animate || REDUCED) tile.classList.add('in');
        else setTimeout(function () { tile.classList.add('in'); }, Math.min(520, i * 9));
      });
      renderCrumbs(path);
    }

    function renderCrumbs(path) {
      crumbs.textContent = '';
      var parts = path ? path.split('/') : [];
      var b0 = el('button', null, DATA.meta.repoName + (parts.length ? ' /' : ''));
      b0.addEventListener('click', function () { setPath(''); });
      crumbs.appendChild(b0);
      var acc = '';
      parts.forEach(function (p, i) {
        acc = acc ? acc + '/' + p : p;
        var target = acc;
        var b = el('button', null, p + (i < parts.length - 1 ? ' /' : ''));
        b.addEventListener('click', function () { setPath(target); });
        crumbs.appendChild(b);
      });
    }

    function setPath(path) {
      if (!layouts[path]) return;
      current = path;
      draw(path, true);
    }

    observe(host.parentNode.parentNode, function () {
      played = true;
      draw(current, true);
    });
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (!played) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { draw(current, false); }, 160);
    });
  })();

  /* ------------------------------------------------------------- knowledge */
  (function knowledge() {
    var row = $('busRow'), own = $('ownership'), legend = $('authorLegend');
    var k = DATA.knowledge;
    var cards = [
      { v: num(k.busFactor), s: 'people account for half of every line ever changed' },
      { v: num(DATA.hero.authors), s: 'contributors in total' },
      { v: (DATA.authors[0] ? Math.round((DATA.authors[0].commits / Math.max(1, DATA.hero.commits)) * 100) + '%' : '—'), s: 'of commits from the single most active author' }
    ];
    cards.forEach(function (c) {
      var card = el('div', 'stat-card');
      card.appendChild(el('b', null, c.v));
      card.appendChild(el('span', null, c.s));
      row.appendChild(card);
    });

    var bars = [];
    (k.dirs || []).forEach(function (d) {
      var wrap = el('div', 'own-row');
      var head = el('div', 'own-head');
      var code = el('code', null, d.name);
      head.appendChild(code);
      head.appendChild(el('em', null, compact(d.lines) + ' lines · bus factor ' + d.busFactor));
      wrap.appendChild(head);
      var bar = el('div', 'own-bar');
      var total = Math.max(1, d.shares.reduce(function (a, b) { return a + b.lines; }, 0));
      d.shares.forEach(function (sh) {
        var seg = el('i');
        seg.style.background = authorColor(sh.author);
        seg.dataset.w = ((sh.lines / total) * 100).toFixed(2) + '%';
        bindTip(seg, function () {
          return '<span class="tt-title">' + esc(d.name) + '</span>' +
            ttRow(esc(sh.author), num(sh.lines) + ' lines (' + Math.round((sh.lines / total) * 100) + '%)');
        });
        bar.appendChild(seg);
        bars.push(seg);
      });
      wrap.appendChild(bar);
      own.appendChild(wrap);
    });

    (DATA.knowledge.authors || []).slice(0, 14).forEach(function (a) {
      var item = el('span', null);
      var i = el('i');
      i.style.background = a.color;
      item.appendChild(i);
      item.appendChild(el('b', null, a.name + ' · ' + num(a.commits)));
      legend.appendChild(item);
    });

    observe(own.parentNode, function () {
      bars.forEach(function (b, i) {
        setTimeout(function () { b.style.width = b.dataset.w; }, REDUCED ? 0 : i * 12);
      });
    });
  })();

  /* --------------------------------------------------- coupling force graph */
  (function coupling() {
    var host = $('graph'), table = $('couplingTable');
    var nodes = (DATA.coupling.nodes || []).map(function (n) { return { id: n.id, label: n.label, dir: n.dir, degree: n.degree, weight: n.weight }; });
    var edges = DATA.coupling.edges || [];
    var pairs = DATA.coupling.pairs || [];

    /* table */
    var thead = el('thead');
    var htr = el('tr');
    ['#', 'File A', 'File B', 'Together', 'Strength'].forEach(function (h) { htr.appendChild(el('th', null, h)); });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el('tbody');
    var miniBars = [];
    if (!pairs.length) {
      var tr0 = el('tr');
      var td0 = el('td', null, 'No file pair changed together more than once in this range.');
      td0.colSpan = 5;
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    }
    pairs.forEach(function (p, i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, String(i + 1)));
      var a = el('td'); a.appendChild(el('code', null, p.a)); tr.appendChild(a);
      var b = el('td'); b.appendChild(el('code', null, p.b)); tr.appendChild(b);
      tr.appendChild(el('td', null, num(p.count) + '×'));
      var sc = el('td', 'bar-cell');
      var mb = el('div', 'mini-bar');
      mb.dataset.w = Math.round(p.strength * 100) + '%';
      sc.appendChild(mb);
      sc.appendChild(el('span', null, Math.round(p.strength * 100) + '%'));
      miniBars.push(mb);
      tr.appendChild(sc);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    observe(table.parentNode.parentNode, function () {
      miniBars.forEach(function (m, i) { setTimeout(function () { m.style.width = m.dataset.w; }, REDUCED ? 0 : i * 18); });
    });

    if (!nodes.length) {
      host.parentNode.appendChild(el('p', 'lede', 'Not enough co-change signal for a graph.'));
      host.style.display = 'none';
      return;
    }

    var W = 900, H = 520;
    host.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    host.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    /* seed on a circle so the first frames look deliberate rather than random */
    nodes.forEach(function (n, i) {
      var a = (i / nodes.length) * Math.PI * 2;
      n.x = W / 2 + Math.cos(a) * (W * 0.26);
      n.y = H / 2 + Math.sin(a) * (H * 0.3);
      n.vx = 0; n.vy = 0;
      n.r = clamp(4 + Math.sqrt(n.weight) * 1.5, 4.5, 17);
    });

    var edgeEls = edges.map(function (e) {
      var line = svg('line', { class: 'g-edge', 'stroke-width': clamp(0.7 + e.strength * 3.4, 0.7, 4.2) });
      line.style.opacity = REDUCED ? '1' : '0';
      line.style.transition = 'opacity 0.9s cubic-bezier(0.22,1,0.36,1)';
      host.appendChild(line);
      return line;
    });
    var nodeEls = nodes.map(function (n, i) {
      var g = svg('g', { class: 'g-node' });
      var c = svg('circle', { r: n.r, fill: dirColor(n.dir), stroke: 'rgba(7,8,12,0.9)', 'stroke-width': '1.5' });
      g.appendChild(c);
      var label = svg('text', { x: n.r + 4, y: 3.5 });
      label.textContent = n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label;
      g.appendChild(label);
      g.style.opacity = REDUCED ? '1' : '0';
      g.style.transition = 'opacity 0.7s cubic-bezier(0.22,1,0.36,1)';
      bindTip(g, function () {
        return '<span class="tt-title">' + esc(n.id) + '</span>' +
          ttRow('Commits', num(n.weight)) + ttRow('Coupled with', num(n.degree) + ' file(s)');
      });
      /* drag */
      g.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        g.setPointerCapture(ev.pointerId);
        n.fixed = true;
        var box = host.getBoundingClientRect();
        var move = function (e2) {
          n.x = ((e2.clientX - box.left) / box.width) * W;
          n.y = ((e2.clientY - box.top) / box.height) * H;
          n.vx = 0; n.vy = 0;
          alpha = Math.max(alpha, 0.35);
          if (!running) { running = true; requestAnimationFrame(tick); }
        };
        var up = function () {
          n.fixed = false;
          g.removeEventListener('pointermove', move);
          g.removeEventListener('pointerup', up);
        };
        g.addEventListener('pointermove', move);
        g.addEventListener('pointerup', up);
      });
      host.appendChild(g);
      void i;
      return g;
    });

    function dirColor(dir) {
      var h = 0;
      for (var i = 0; i < dir.length; i++) h = (h * 31 + dir.charCodeAt(i)) | 0;
      return 'hsl(' + ((Math.abs(h) * 47) % 360) + ' 64% 62%)';
    }

    /* A tiny force simulation: Coulomb repulsion, Hooke springs on the coupled
       pairs, and a weak pull to the centre. ~60 nodes, so O(n^2) is free. */
    var alpha = 1, running = false;
    function step() {
      var i, j, a, b, dx, dy, d2, d, f;
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          b = nodes[j];
          dx = b.x - a.x; dy = b.y - a.y;
          d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); }
          d = Math.sqrt(d2);
          f = (5200 * alpha) / d2;
          var ux = dx / d, uy = dy / d;
          a.vx -= ux * f; a.vy -= uy * f;
          b.vx += ux * f; b.vy += uy * f;
        }
      }
      for (i = 0; i < edges.length; i++) {
        a = nodes[edges[i].source]; b = nodes[edges[i].target];
        if (!a || !b) continue;
        dx = b.x - a.x; dy = b.y - a.y;
        d = Math.sqrt(dx * dx + dy * dy) || 1;
        var rest = 72 + (1 - edges[i].strength) * 78;
        f = ((d - rest) * 0.055 * alpha);
        var vx = (dx / d) * f, vy = (dy / d) * f;
        a.vx += vx; a.vy += vy;
        b.vx -= vx; b.vy -= vy;
      }
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        a.vx += (W / 2 - a.x) * 0.0035 * alpha;
        a.vy += (H / 2 - a.y) * 0.0045 * alpha;
        if (a.fixed) { a.vx = 0; a.vy = 0; continue; }
        a.vx *= 0.86; a.vy *= 0.86;
        a.x = clamp(a.x + clamp(a.vx, -26, 26), a.r + 6, W - a.r - 70);
        a.y = clamp(a.y + clamp(a.vy, -26, 26), a.r + 10, H - a.r - 10);
      }
      alpha *= 0.985;
    }
    function paint() {
      for (var i = 0; i < edges.length; i++) {
        var a = nodes[edges[i].source], b = nodes[edges[i].target];
        if (!a || !b) continue;
        edgeEls[i].setAttribute('x1', a.x.toFixed(1));
        edgeEls[i].setAttribute('y1', a.y.toFixed(1));
        edgeEls[i].setAttribute('x2', b.x.toFixed(1));
        edgeEls[i].setAttribute('y2', b.y.toFixed(1));
      }
      for (var k = 0; k < nodes.length; k++) {
        nodeEls[k].setAttribute('transform', 'translate(' + nodes[k].x.toFixed(1) + ',' + nodes[k].y.toFixed(1) + ')');
      }
    }
    function tick() {
      step();
      paint();
      if (alpha > 0.008) requestAnimationFrame(tick);
      else { running = false; alpha = 0.008; }
    }

    /* settle off-screen so the graph is readable the moment it scrolls in */
    for (var pre = 0; pre < 90; pre++) step();
    paint();

    observe(host.parentNode.parentNode, function () {
      nodeEls.forEach(function (g, i) { setTimeout(function () { g.style.opacity = '1'; }, REDUCED ? 0 : i * 22); });
      edgeEls.forEach(function (l, i) { setTimeout(function () { l.style.opacity = '1'; }, REDUCED ? 0 : 200 + i * 16); });
      alpha = 0.55;
      if (!running) { running = true; requestAnimationFrame(tick); }
    });
  })();

  revealAll();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tipHide(); });
})();
