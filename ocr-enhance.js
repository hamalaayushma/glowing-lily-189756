(function () {
  'use strict';

  // Tesseract struggles with small, low-contrast handwriting. Try enlarged,
  // contrast-enhanced variants and retain the result that finds the most
  // date/amount-like rows. The user can still review and edit the OCR text.
  function makeVariants(file) {
    return createImageBitmap(file).then(function (bitmap) {
      const scale = Math.min(3, 2800 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const source = document.createElement('canvas');
      source.width = width;
      source.height = height;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      sourceContext.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const pixels = sourceContext.getImageData(0, 0, width, height);
      const variants = [];
      [false, true, 'threshold'].forEach(function (mode) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const output = context.createImageData(width, height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          let gray = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2];
          if (mode === true) gray = Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128));
          if (mode === 'threshold') gray = gray > 178 ? 255 : 0;
          output.data[i] = output.data[i + 1] = output.data[i + 2] = gray;
          output.data[i + 3] = 255;
        }
        context.putImageData(output, 0, 0);
        variants.push(canvas);
      });
      return variants;
    });
  }

  function qualityScore(text) {
    const lines = text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    const dateLike = (text.match(/\b\d{1,2}\s*[\/.-]\s*\d{1,2}\b/g) || []).length;
    const amountLike = (text.match(/\$?\s*\d{1,4}[.,]\d{2}\b/g) || []).length;
    const numericLines = lines.filter(function (line) { return /\d/.test(line); }).length;
    return dateLike * 8 + amountLike * 6 + numericLines * 2 + Math.min(lines.length, 12);
  }

  function enhanceReader() {
    const button = document.getElementById('readImage');
    if (!button || button.dataset.enhancedOcr === 'true') return;
    button.dataset.enhancedOcr = 'true';
    button.onclick = async function () {
      const input = document.getElementById('paymentImage');
      const file = input && input.files && input.files[0];
      if (!file) return;
      const status = document.getElementById('ocrStatus');
      const textArea = document.getElementById('ocrText');
      button.disabled = true;
      status.textContent = 'Preparing image and trying enhanced text recognition…';
      let worker;
      try {
        if (!window.Tesseract) {
          await new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.onload = resolve;
            script.onerror = function () { reject(new Error('Could not load OCR library. Check your internet connection.')); };
            document.head.appendChild(script);
          });
        }
        const variants = await makeVariants(file);
        worker = await Tesseract.createWorker('eng');
        let bestText = '';
        let bestScore = -1;
        const passes = [
          { image: variants[0], mode: '11' },
          { image: variants[1], mode: '6' },
          { image: variants[2], mode: '11' }
        ];
        for (let i = 0; i < passes.length; i++) {
          status.textContent = 'Reading image (pass ' + (i + 1) + ' of ' + passes.length + ')…';
          await worker.setParameters({ tessedit_pageseg_mode: passes[i].mode });
          const result = await worker.recognize(passes[i].image);
          const candidate = result.data.text || '';
          const score = qualityScore(candidate);
          if (score > bestScore) {
            bestText = candidate;
            bestScore = score;
          }
        }
        textArea.value = bestText;
        status.textContent = 'Text recognition finished. Handwriting may need correction; review the text below before finding payment rows.';
      } catch (error) {
        status.textContent = error.message || 'Could not read the image. You can type or paste payment lines below.';
      } finally {
        if (worker) await worker.terminate().catch(function () {});
        button.disabled = false;
      }
    };
  }

  if (document.readyState === 'complete') enhanceReader();
  else window.addEventListener('load', enhanceReader, { once: true });
})();
