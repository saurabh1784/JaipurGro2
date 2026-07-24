(function () {
  'use strict';
  const logoPath = '/assets/images/GroLogo.png';
  const palettes = [['#0f766e','#14b8a6'],['#1d4ed8','#60a5fa'],['#7c3aed','#a78bfa'],['#be123c','#fb7185'],['#c2410c','#fb923c'],['#3f6212','#84cc16'],['#0369a1','#38bdf8'],['#a21caf','#e879f9']];
  function hash(value) { return Array.from(String(value || 'Product')).reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0); }
  function fallbackSvg(name) {
    const label = String(name || 'Product').trim() || 'Product';
    const initials = label.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase().replace(/[&<>"']/g, '');
    const [start, end] = palettes[Math.abs(hash(label)) % palettes.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="320" height="240" rx="24" fill="url(#g)"/><path d="M112 91h96l-8 82a16 16 0 0 1-16 14h-48a16 16 0 0 1-16-14l-8-82Z" fill="white" fill-opacity=".2"/><path d="M136 99V83a24 24 0 0 1 48 0v16" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/><text x="160" y="151" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="42" font-weight="700">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  window.productImageFallback = function (image) {
    if (!image) return;
    if (image.dataset.placeholderComplete === 'true') {
      if (String(image.src || '').startsWith('data:image/svg+xml')) return;
      delete image.dataset.placeholderComplete;
      delete image.dataset.logoFallbackTried;
    }
    const name = image.dataset.productName || image.alt || 'Product';
    if (image.dataset.logoFallbackTried !== 'true') { image.dataset.logoFallbackTried = 'true'; image.src = logoPath; return; }
    image.dataset.placeholderComplete = 'true'; image.src = fallbackSvg(name); image.style.backgroundColor = 'transparent';
  };
  window.addEventListener('error', function (event) {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.hasAttribute('data-product-placeholder')) window.productImageFallback(image);
  }, true);
})();