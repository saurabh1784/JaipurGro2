(function () {
  const presets = {
    product: { width: 900, height: 900, label: 'Product Image' },
    category: { width: 512, height: 512, label: 'Category Image' },
    subcategory: { width: 512, height: 512, label: 'Subcategory Image' },
    brand: { width: 512, height: 512, label: 'Brand Logo' },
    banner: { width: 1600, height: 600, label: 'Banner Image' },
    promotion: { width: 1200, height: 675, label: 'Promotion Image' },
    profile: { width: 512, height: 512, label: 'Profile Image' },
    signature: { width: 900, height: 360, label: 'Signature Image' },
  };

  let state = null;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialOffsetX = 0;
  let initialOffsetY = 0;

  function inferPreset(input) {
    const haystack = `${input.id || ''} ${input.name || ''} ${input.closest('form')?.id || ''}`.toLowerCase();
    if (haystack.includes('banner') || haystack.includes('advertisement') || haystack.includes('ad')) return 'banner';
    if (haystack.includes('promo') || haystack.includes('coupon') || haystack.includes('discount')) return 'promotion';
    if (haystack.includes('brand') || haystack.includes('logo')) return 'brand';
    if (haystack.includes('subcategory') || haystack.includes('sub_category')) return 'subcategory';
    if (haystack.includes('category') || haystack.includes('icon')) return 'category';
    if (haystack.includes('signature')) return 'signature';
    if (haystack.includes('profile') || haystack.includes('avatar')) return 'profile';
    return 'product';
  }

  function ensureModal() {
    let modal = document.getElementById('imageEditorModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'imageEditorModal';
    modal.className = 'image-editor-modal';
    modal.innerHTML = `
      <div class="image-editor-card" role="dialog" aria-modal="true" aria-labelledby="imageEditorTitle">
        <div class="image-editor-header">
          <div class="image-editor-header-title">
            <div class="image-editor-header-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            </div>
            <div>
              <span class="image-editor-badge">Image Studio</span>
              <h3 id="imageEditorTitle">Edit Image</h3>
            </div>
          </div>
          <button type="button" class="image-editor-close-btn" data-editor-close aria-label="Close modal">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="image-editor-stage-wrap">
          <canvas id="imageEditorCanvas" class="image-editor-canvas"></canvas>
          <div class="image-editor-stage-hint">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/></svg>
            <span>Drag image on canvas or use buttons below to adjust position</span>
          </div>
        </div>

        <div class="image-editor-toolbar">
          <div class="image-editor-zoom-group">
            <span class="image-editor-zoom-label">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              Zoom
            </span>
            <button type="button" class="editor-zoom-btn" data-editor-zoom-step="-0.15" title="Zoom out">−</button>
            <input id="imageEditorZoom" type="range" min="0.5" max="4" step="0.01" value="1">
            <button type="button" class="editor-zoom-btn" data-editor-zoom-step="0.15" title="Zoom in">+</button>
            <span id="imageEditorZoomValue" class="editor-zoom-val">100%</span>
          </div>

          <div class="image-editor-tools-group">
            <div class="editor-btn-group" aria-label="Position controls">
              <button type="button" class="editor-icon-btn" data-editor-move="left" title="Move Left">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                <span>Left</span>
              </button>
              <button type="button" class="editor-icon-btn" data-editor-move="up" title="Move Up">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                <span>Up</span>
              </button>
              <button type="button" class="editor-icon-btn" data-editor-move="down" title="Move Down">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                <span>Down</span>
              </button>
              <button type="button" class="editor-icon-btn" data-editor-move="right" title="Move Right">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span>Right</span>
              </button>
            </div>

            <div class="editor-btn-group" aria-label="Transform controls">
              <button type="button" class="editor-icon-btn" data-editor-rotate title="Rotate 90 degrees">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                <span>Rotate</span>
              </button>
              <button type="button" class="editor-icon-btn editor-btn-reset" data-editor-reset title="Reset Image">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>

        <div class="image-editor-preview-card">
          <div class="image-editor-preview-thumb">
            <canvas id="imageEditorPreview" class="image-editor-preview"></canvas>
          </div>
          <div class="image-editor-preview-meta">
            <div class="preview-meta-title">Final Output Preview</div>
            <div class="preview-meta-dims" id="imageEditorSize">1600 × 600 px</div>
            <div class="preview-meta-format">Optimized WebP Output</div>
          </div>
        </div>

        <div class="image-editor-actions">
          <button type="button" class="editor-btn-cancel" data-editor-cancel>Cancel</button>
          <button type="button" class="editor-btn-apply" data-editor-apply>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            <span>Use Image</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const canvas = modal.querySelector('#imageEditorCanvas');
    canvas.addEventListener('mousedown', (e) => {
      if (!state) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialOffsetX = state.offsetX;
      initialOffsetY = state.offsetY;
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging || !state) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      state.offsetX = initialOffsetX + dx;
      state.offsetY = initialOffsetY + dy;
      draw();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (canvas) canvas.style.cursor = 'grab';
      }
    });

    modal.addEventListener('click', (event) => {
      const target = event.target.closest('button, [data-editor-close], [data-editor-cancel]');
      if (!target) {
        if (event.target === modal) closeEditor(true);
        return;
      }
      if (target.matches('[data-editor-close], [data-editor-cancel]')) closeEditor(true);
      if (target.matches('[data-editor-rotate]')) {
        state.rotation = (state.rotation + 90) % 360;
        draw();
      }
      if (target.matches('[data-editor-reset]')) resetState();

      const zoomStep = target.dataset.editorZoomStep;
      if (zoomStep) {
        const currentZoom = state.zoom;
        const newZoom = Math.min(4, Math.max(0.5, currentZoom + Number(zoomStep)));
        state.zoom = newZoom;
        document.getElementById('imageEditorZoom').value = newZoom.toString();
        draw();
      }

      const move = target.dataset.editorMove;
      if (move) {
        const step = 24;
        if (move === 'left') state.offsetX -= step;
        if (move === 'right') state.offsetX += step;
        if (move === 'up') state.offsetY -= step;
        if (move === 'down') state.offsetY += step;
        draw();
      }
      if (target.matches('[data-editor-apply]')) applyImage();
    });

    modal.querySelector('#imageEditorZoom').addEventListener('input', (event) => {
      state.zoom = Number(event.target.value);
      draw();
    });

    return modal;
  }

  function resetState() {
    state.zoom = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    state.rotation = 0;
    document.getElementById('imageEditorZoom').value = '1';
    draw();
  }

  function drawCanvas(canvas, targetWidth, targetHeight) {
    const ctx = canvas.getContext('2d');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.save();
    ctx.translate(targetWidth / 2 + state.offsetX, targetHeight / 2 + state.offsetY);
    ctx.rotate((state.rotation * Math.PI) / 180);
    const rotated = state.rotation % 180 !== 0;
    const imgW = rotated ? state.image.height : state.image.width;
    const imgH = rotated ? state.image.width : state.image.height;
    const scale = Math.max(targetWidth / imgW, targetHeight / imgH) * state.zoom;
    ctx.drawImage(state.image, -state.image.width * scale / 2, -state.image.height * scale / 2, state.image.width * scale, state.image.height * scale);
    ctx.restore();
  }

  function draw() {
    const preset = presets[state.preset];
    const displayWidth = Math.min(720, Math.max(280, preset.width));
    const displayHeight = Math.round(displayWidth * preset.height / preset.width);
    drawCanvas(document.getElementById('imageEditorCanvas'), displayWidth, displayHeight);
    drawCanvas(document.getElementById('imageEditorPreview'), Math.min(200, preset.width), Math.round(Math.min(200, preset.width) * preset.height / preset.width));
    document.getElementById('imageEditorSize').textContent = `${preset.width} × ${preset.height} px`;
    const zoomValEl = document.getElementById('imageEditorZoomValue');
    if (zoomValEl) zoomValEl.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function closeEditor(clearInput) {
    const modal = ensureModal();
    modal.classList.remove('active');
    if (clearInput && state?.input) state.input.value = '';
    state = null;
  }

  function applyImage() {
    const preset = presets[state.preset];
    const output = document.createElement('canvas');
    drawCanvas(output, preset.width, preset.height);
    output.toBlob((blob) => {
      if (!blob) return closeEditor(true);
      const file = new File([blob], `${(state.originalName || 'image').replace(/\.[^.]+$/, '')}-edited.webp`, { type: 'image/webp' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      state.input.files = transfer.files;
      state.input.dispatchEvent(new Event('change', { bubbles: true }));
      closeEditor(false);
    }, 'image/webp', 0.90);
  }

  function openEditor(input, file) {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        state = {
          input,
          image,
          preset: input.dataset.imagePreset || inferPreset(input),
          originalName: file.name,
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
        };
        const modal = ensureModal();
        document.getElementById('imageEditorTitle').textContent = presets[state.preset].label;
        document.getElementById('imageEditorZoom').value = '1';
        modal.classList.add('active');
        draw();
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function bindInputs(root = document) {
    root.querySelectorAll('input[type="file"][accept*="image"]:not([data-image-editor-bound])').forEach((input) => {
      if (input.multiple) return;
      input.dataset.imageEditorBound = 'true';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file && /^image\//.test(file.type) && !file.name.endsWith('-edited.webp')) {
          openEditor(input, file);
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => bindInputs());
  window.ImageUploadEditor = { bindInputs, presets };
})();
