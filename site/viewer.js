(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const MAP_MIN = -2500, MAP_MAX = 2500;
  const state = { data: null, layout: 'map', selected: null, route: null };
  const view = { x: 0, y: 0, k: 1, user: false };
  const positions = new Map(), edgeEls = [], nodeEls = new Map();

  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const city = id => state.data.cities.find(item => item.id === id);
  const hasCoords = item => Number.isFinite(item.x) && Number.isFinite(item.z);
  const inLinks = id => state.data.links.filter(link => link.to === id);
  const outLinks = id => state.data.links.filter(link => link.from === id);

  async function init() {
    try {
      const response = await fetch('network.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Network data could not be loaded (HTTP ${response.status}).`);
      state.data = await response.json();
      bindControls();
      fillRoutes();
      render();
      $('summary').textContent = `${state.data.cities.length} cities · ${state.data.links.length} directed links · read-only`;
      $('loading').hidden = true;
    } catch (error) {
      $('loading').hidden = true;
      $('error').hidden = false;
      $('error').textContent = error.message;
    }
  }

  function layoutPositions() {
    positions.clear();
    const cities = state.data.cities;
    if (state.layout === 'circle') {
      const radius = Math.max(1500, cities.length * 150);
      cities.forEach((item, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, cities.length);
        positions.set(item.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      });
      return;
    }
    const missing = cities.filter(item => !hasCoords(item));
    cities.filter(hasCoords).forEach(item => positions.set(item.id, { x: item.x, y: item.z }));
    missing.forEach((item, index) => positions.set(item.id, {
      x: -2200 + index * (4400 / Math.max(1, missing.length - 1)), y: 2900,
    }));
  }

  function render() {
    layoutPositions();
    drawGrid();
    drawEdges();
    drawNodes();
    applyHighlight();
    fitView();
  }

  function drawGrid() {
    const group = $('grid'); group.replaceChildren();
    if (state.layout !== 'map') return;
    group.append(svg('rect', { x: MAP_MIN, y: MAP_MIN, width: MAP_MAX - MAP_MIN, height: MAP_MAX - MAP_MIN }));
    for (let value = MAP_MIN; value <= MAP_MAX; value += 500) {
      group.append(svg('line', { x1: value, y1: MAP_MIN, x2: value, y2: MAP_MAX, class: value === 0 ? 'axis' : '' }));
      group.append(svg('line', { x1: MAP_MIN, y1: value, x2: MAP_MAX, y2: value, class: value === 0 ? 'axis' : '' }));
      const tx = svg('text', { x: value + 25, y: MAP_MIN - 70 }); tx.textContent = `X ${value.toLocaleString('en-US')}`;
      const tz = svg('text', { x: MAP_MIN + 25, y: value - 25 }); tz.textContent = `Z ${value.toLocaleString('en-US')}`;
      group.append(tx, tz);
    }
  }

  function edgePath(from, to, reciprocal) {
    const a = positions.get(from), b = positions.get(to);
    if (!a || !b) return '';
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    const pad = 86, x1 = a.x + dx / length * pad, y1 = a.y + dy / length * pad;
    const x2 = b.x - dx / length * pad, y2 = b.y - dy / length * pad;
    if (!reciprocal) return `M${x1},${y1} L${x2},${y2}`;
    const bend = Math.min(150, length * .14), nx = -dy / length * bend, ny = dx / length * bend;
    return `M${x1},${y1} Q${(x1 + x2) / 2 + nx},${(y1 + y2) / 2 + ny} ${x2},${y2}`;
  }

  function drawEdges() {
    const group = $('edges'); group.replaceChildren(); edgeEls.length = 0;
    const keys = new Set(state.data.links.map(link => `${link.from}>${link.to}`));
    for (const link of state.data.links) {
      const path = svg('path', {
        class: 'edge',
        d: edgePath(link.from, link.to, keys.has(`${link.to}>${link.from}`)),
      });
      group.append(path); edgeEls.push({ ...link, element: path });
    }
  }

  function drawNodes() {
    const group = $('nodes'); group.replaceChildren(); nodeEls.clear();
    for (const item of state.data.cities) {
      const p = positions.get(item.id), incoming = inLinks(item.id).length, outgoing = outLinks(item.id).length;
      const status = incoming >= state.data.maxIn && outgoing >= state.data.maxOut ? 'full'
        : incoming >= state.data.maxIn || outgoing >= state.data.maxOut ? 'warn' : '';
      const node = svg('g', { class: `node-group ${status}`, transform: `translate(${p.x},${p.y})`, tabindex: '0', role: 'button', 'aria-label': item.name });
      const circle = svg('circle', { r: 76 });
      const label = svg('text', { y: 150 }); label.textContent = item.name;
      const title = svg('title'); title.textContent = `${item.name} · ${incoming} incoming · ${outgoing} outgoing`;
      node.append(circle, label, title);
      node.addEventListener('click', event => { event.stopPropagation(); selectCity(item.id); });
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') selectCity(item.id); });
      group.append(node); nodeEls.set(item.id, node);
    }
  }

  function selectCity(id) {
    state.selected = state.selected === id ? null : id;
    const item = state.selected ? city(state.selected) : null;
    $('cityCard').hidden = !item;
    if (item) {
      $('cityName').textContent = item.name;
      $('cityCoords').textContent = hasCoords(item) ? `X ${item.x.toLocaleString('en-US')} · Z ${item.z.toLocaleString('en-US')}` : 'Coordinates unavailable';
      $('cityIn').textContent = inLinks(item.id).length;
      $('cityOut').textContent = outLinks(item.id).length;
    }
    applyHighlight();
  }

  function shortestPath(from, to) {
    const queue = [from], previous = new Map([[from, null]]);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current === to) break;
      for (const link of outLinks(current)) if (!previous.has(link.to)) { previous.set(link.to, current); queue.push(link.to); }
    }
    if (!previous.has(to)) return null;
    const result = [];
    for (let current = to; current != null; current = previous.get(current)) result.push(current);
    return result.reverse();
  }

  function updateRoute() {
    const from = Number($('routeFrom').value), to = Number($('routeTo').value);
    state.route = from && to && from !== to ? shortestPath(from, to) : null;
    $('routeResult').hidden = !from || !to;
    if (!from || !to) $('routeResult').textContent = '';
    else if (from === to) $('routeResult').textContent = 'Start and destination are the same city.';
    else if (!state.route) $('routeResult').textContent = 'No directed route is available.';
    else $('routeResult').textContent = `${state.route.length - 1} hop${state.route.length === 2 ? '' : 's'} · ${state.route.map(id => city(id).name).join(' → ')}`;
    applyHighlight();
  }

  function applyHighlight() {
    const routeNodes = new Set(state.route || []), routeEdges = new Set();
    if (state.route) for (let i = 0; i + 1 < state.route.length; i++) routeEdges.add(`${state.route[i]}>${state.route[i + 1]}`);
    for (const edge of edgeEls) {
      let className = 'edge';
      if (state.route) className += routeEdges.has(`${edge.from}>${edge.to}`) ? ' on-route' : ' dim';
      else if (state.selected) className += edge.from === state.selected ? ' out' : edge.to === state.selected ? ' in' : ' dim';
      edge.element.setAttribute('class', className);
    }
    for (const [id, node] of nodeEls) {
      node.classList.toggle('selected', id === state.selected);
      node.classList.toggle('dim', Boolean(state.route) && !routeNodes.has(id));
    }
  }

  function fillRoutes() {
    const sorted = [...state.data.cities].sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const select of [$('routeFrom'), $('routeTo')]) {
      for (const item of sorted) select.append(new Option(item.name, String(item.id)));
      select.addEventListener('change', updateRoute);
    }
  }

  function applyView() {
    const graph = $('graph'), width = graph.clientWidth, height = graph.clientHeight;
    $('viewport').setAttribute('transform', `translate(${width / 2 + view.x},${height / 2 + view.y}) scale(${view.k})`);
  }

  function fitView() {
    const graph = $('graph'), values = [...positions.values()];
    if (!values.length) return;
    let x0 = Math.min(...values.map(p => p.x)), x1 = Math.max(...values.map(p => p.x));
    let y0 = Math.min(...values.map(p => p.y)), y1 = Math.max(...values.map(p => p.y));
    if (state.layout === 'map') { x0 = Math.min(x0, MAP_MIN); x1 = Math.max(x1, MAP_MAX); y0 = Math.min(y0, MAP_MIN); y1 = Math.max(y1, MAP_MAX); }
    const pad = 220, width = graph.clientWidth, height = graph.clientHeight;
    view.k = Math.max(.025, Math.min(.5, (width - pad) / Math.max(1, x1 - x0), (height - pad) / Math.max(1, y1 - y0)));
    view.x = -(x0 + x1) / 2 * view.k;
    view.y = -(y0 + y1) / 2 * view.k;
    view.user = false; applyView();
  }

  function bindControls() {
    $('mapLayout').addEventListener('click', () => setLayout('map'));
    $('circleLayout').addEventListener('click', () => setLayout('circle'));
    $('fitView').addEventListener('click', fitView);
    $('closeCity').addEventListener('click', () => selectCity(state.selected));
    const graph = $('graph');
    let drag = null;
    graph.addEventListener('pointerdown', event => {
      if (event.target.closest('.node-group')) return;
      drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
      graph.classList.add('dragging'); graph.setPointerCapture(event.pointerId);
    });
    graph.addEventListener('pointermove', event => {
      if (!drag) return;
      view.x = drag.vx + event.clientX - drag.x; view.y = drag.vy + event.clientY - drag.y; view.user = true; applyView();
    });
    const end = () => { drag = null; graph.classList.remove('dragging'); };
    graph.addEventListener('pointerup', end); graph.addEventListener('pointercancel', end);
    graph.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = graph.getBoundingClientRect(), mx = event.clientX - rect.left - rect.width / 2, my = event.clientY - rect.top - rect.height / 2;
      const next = Math.max(.015, Math.min(2.5, view.k * Math.exp(-event.deltaY * .0015)));
      view.x = mx - (mx - view.x) * next / view.k; view.y = my - (my - view.y) * next / view.k; view.k = next; view.user = true; applyView();
    }, { passive: false });
    window.addEventListener('resize', () => view.user ? applyView() : fitView());
  }

  function setLayout(layout) {
    state.layout = layout;
    $('mapLayout').classList.toggle('active', layout === 'map');
    $('circleLayout').classList.toggle('active', layout === 'circle');
    render();
  }

  init();
})();
