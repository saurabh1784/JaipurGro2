(function () {
  const presets = {
    product: { width: 900, height: 900, label: 'Product image' },
    category: { width: 512, height: 512, label: 'Category image' },
    subcategory: { width: 512, height: 512, label: 'Subcategory image' },
    brand: { width: 512, height: 512, label: 'Brand logo' },
    banner: { width: 1600, height: 600, label: 'Banner image' },
    promotion: { width: 1200, height: 675, label: 'Promotion image' },
    profile: { width: 512, height: 512, label: 'Profile image' },
    signature: { width: 900, height: 360, label: 'Signature image' },
  };

  let state = null;

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
          <div>
            <span>Image Editor</span>
            <strong id="imageEditorTitle">Edit image</strong>
          </div>
          <button type="button" data-editor-close>Close</button>
        </div>
        <div class="image-editor-stage-wrap">
          <canvas id="imageEditorCanvas" class="image-editor-canvas"></canvas>
        </div>
        <div class="image-editor-controls">
          <label>Zoom <input id="imageEditorZoom" type="range" min="0.5" max="4" step="0.01" value="1"></label>
          <div class="image-editor-buttons">
            <button type="button" data-editor-move="left">Left</button>
            <button type="button" data-editor-move="right">Right</button>
            <button type="button" data-editor-move="up">Up</button>
            <button type="button" data-editor-move="down">Down</button>
            <button type="button" data-editor-rotate>Rotate</button>
            <button type="button" data-editor-reset>Reset</button>
          </div>
        </div>
        <div class="image-editor-preview-row">
          <canvas id="imageEditorPreview" class="image-editor-preview"></canvas>
          <div>
            <strong>Final preview</strong>
            <p id="imageEditorSize"></p>
          </div>
        </div>
        <div class="image-editor-actions">
          <button type="button" data-editor-cancel>Cancel</button>
          <button type="button" class="settings-save" data-editor-apply>Use Image</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.matches('[data-editor-close], [data-editor-cancel]')) closeEditor(true);
      if (event.target.matches('[data-editor-rotate]')) {
        state.rotation = (state.rotation + 90) % 360;
        draw();
      }
      if (event.target.matches('[data-editor-reset]')) resetState();
      const move = event.target.dataset.editorMove;
      if (move) {
        const step = 18;
        if (move === 'left') state.offsetX -= step;
        if (move === 'right') state.offsetX += step;
        if (move === 'up') state.offsetY -= step;
        if (move === 'down') state.offsetY += step;
        draw();
      }
      if (event.target.matches('[data-editor-apply]')) applyImage();
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
    ctx.fillStyle = '#fff';
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
    drawCanvas(document.getElementById('imageEditorPreview'), Math.min(220, preset.width), Math.round(Math.min(220, preset.width) * preset.height / preset.width));
    document.getElementById('imageEditorSize').textContent = `${preset.width} x ${preset.height}px`;
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
      closeEditor(false);
    }, 'image/webp', 0.88);
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
        if (file && /^image\//.test(file.type)) openEditor(input, file);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => bindInputs());
  window.ImageUploadEditor = { bindInputs, presets };
})();
