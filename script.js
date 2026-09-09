/* ==========================================================================
   BINI IN-HOUSE WEBP CONVERTER - GALAXY STUDIO BATCH EDITION SCRIPT
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------------
    // 1. Application State & Global References
    // ----------------------------------------------------------------------
    const state = {
        currentStep: 1,
        filesQueue: [], // Array of queue items: { id, file, name, size, type, ext, isValid, errorMsg, status, originalDataUrl, imageObj, webpBlob, webpUrl, webpSize, savingsPercent, width, height }
        qualityValue: 75,
        rotation: 0, // 0, 90, 180, 270
        flipH: false,
        flipV: false,
        aspectRatio: 'original', // 'original', 'landscape', 'portrait', 'square'
        encodingMode: 'lossy', // 'lossy' or 'lossless'
        activePreviewIndex: 0,
        zipBlob: null,
        zipFileName: 'BINI_WebP_Converted_Batch.zip'
    };

    const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif', 'svg'];
    const SUPPORTED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/gif', 'image/avif', 'image/svg+xml'];

    // DOM Elements - Stepper Navigation
    const navSteps = [
        document.getElementById('navStep1'),
        document.getElementById('navStep2'),
        document.getElementById('navStep3'),
        document.getElementById('navStep4')
    ];
    const navLines = [
        document.getElementById('line1'),
        document.getElementById('line2'),
        document.getElementById('line3')
    ];

    // DOM Elements - Views
    const stepViews = [
        document.getElementById('step1View'),
        document.getElementById('step2View'),
        document.getElementById('step3View'),
        document.getElementById('step4View')
    ];

    // DOM Elements - Banner Notification & Errors
    const validationBanner = document.getElementById('validationBanner');
    const bannerMessage = document.getElementById('bannerMessage');
    const closeBannerBtn = document.getElementById('closeBannerBtn');
    const unsupportedFilesList = document.getElementById('unsupportedFilesList');
    const clearInvalidBtn = document.getElementById('clearInvalidBtn');

    // DOM Elements - Step 1 (Upload & Queue)
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    const selectedFileCard = document.getElementById('selectedFileCard');
    const queueCountBadge = document.getElementById('queueCountBadge');
    const queueValidBadge = document.getElementById('queueValidBadge');
    const queueInvalidBadge = document.getElementById('queueInvalidBadge');
    const fileQueueList = document.getElementById('fileQueueList');
    const addMoreFilesBtn = document.getElementById('addMoreFilesBtn');
    const clearAllQueueBtn = document.getElementById('clearAllQueueBtn');
    const nextToStep2Btn = document.getElementById('nextToStep2Btn');

    // DOM Elements - Step 2 (Quality & Editing Studio)
    const batchPreviewBar = document.getElementById('batchPreviewBar');
    const previewFileSelect = document.getElementById('previewFileSelect');
    const qualityPreviewImg = document.getElementById('qualityPreviewImg');
    const aspectRatioTag = document.getElementById('aspectRatioTag');
    const sourceDimBadge = document.getElementById('sourceDimBadge');
    const orientationBadge = document.getElementById('orientationBadge');
    const rotate90Btn = document.getElementById('rotate90Btn');
    const flipHBtn = document.getElementById('flipHBtn');
    const flipVBtn = document.getElementById('flipVBtn');
    const resetEditBtn = document.getElementById('resetEditBtn');
    const aspectBtns = document.querySelectorAll('.aspect-btn');
    const modeLossyBtn = document.getElementById('modeLossyBtn');
    const modeLosslessBtn = document.getElementById('modeLosslessBtn');

    const qualitySlider = document.getElementById('qualitySlider');
    const qualityValueText = document.getElementById('qualityValueText');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const estOriginalSize = document.getElementById('estOriginalSize');
    const estWebpSize = document.getElementById('estWebpSize');
    const estSavingsChip = document.getElementById('estSavingsChip');
    const backToStep1Btn = document.getElementById('backToStep1Btn');
    const startConvertBtn = document.getElementById('startConvertBtn');

    // DOM Elements - Step 3 (Batch Processing)
    const progressRingCircle = document.getElementById('progressRingCircle');
    const percentText = document.getElementById('percentText');
    const processingTitle = document.getElementById('processingTitle');
    const processingSubtext = document.getElementById('processingSubtext');
    const batchProgressList = document.getElementById('batchProgressList');

    // DOM Elements - Step 4 (Results & ZIP Download)
    const resultOriginalSize = document.getElementById('resultOriginalSize');
    const resultWebpSize = document.getElementById('resultWebpSize');
    const resultSavingsPercent = document.getElementById('resultSavingsPercent');
    const resultBatchCount = document.getElementById('resultBatchCount');
    const downloadZipBtn = document.getElementById('downloadZipBtn');
    const zipSubText = document.getElementById('zipSubText');
    const batchResultsContainer = document.getElementById('batchResultsContainer');

    const convertAnotherBtn = document.getElementById('convertAnotherBtn');
    const downloadWebpBtn = document.getElementById('downloadWebpBtn');
    const toastContainer = document.getElementById('toastContainer');

    // ----------------------------------------------------------------------
    // 2. Helper Functions (Formatting & Notifications)
    // ----------------------------------------------------------------------

    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function getFileExtension(filename) {
        return filename.split('.').pop().toLowerCase();
    }

    function showToast(message, iconClass = 'fa-solid fa-circle-check') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast-item';
        toast.innerHTML = `<i class="${iconClass}" style="color: var(--color-primary-cyan);"></i> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(40px)';
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    function hideErrorBanner() {
        if (validationBanner) validationBanner.classList.add('hidden');
    }

    if (closeBannerBtn) {
        closeBannerBtn.addEventListener('click', hideErrorBanner);
    }

    // ----------------------------------------------------------------------
    // 3. Step Navigation System
    // ----------------------------------------------------------------------

    function goToStep(targetStep) {
        if (targetStep < 1 || targetStep > 4) return;

        state.currentStep = targetStep;

        // Update Stepper Navigation visuals
        navSteps.forEach((stepItem, index) => {
            const stepNum = index + 1;
            stepItem.classList.remove('active', 'completed');
            if (stepNum < targetStep) {
                stepItem.classList.add('completed');
            } else if (stepNum === targetStep) {
                stepItem.classList.add('active');
            }
        });

        // Update connecting lines
        navLines.forEach((line, index) => {
            if (index < targetStep - 1) {
                line.classList.add('active-line');
            } else {
                line.classList.remove('active-line');
            }
        });

        // Toggle Step Views
        stepViews.forEach((view, index) => {
            if (index + 1 === targetStep) {
                view.classList.remove('hidden-step');
                view.classList.add('active-step');
            } else {
                view.classList.remove('active-step');
                view.classList.add('hidden-step');
            }
        });

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ----------------------------------------------------------------------
    // 4. File Validation & Queue Management System
    // ----------------------------------------------------------------------

    function validateFile(file) {
        const ext = getFileExtension(file.name);
        const isExtValid = SUPPORTED_EXTENSIONS.includes(ext);
        const isTypeValid = file.type ? file.type.startsWith('image/') || SUPPORTED_MIMES.includes(file.type) : true;

        if (!isExtValid) {
            return {
                isValid: false,
                errorMsg: `Unsupported file extension (.${ext}). Allowed: JPG, PNG, WEBP, BMP, GIF, AVIF, SVG`
            };
        }

        if (!isTypeValid) {
            return {
                isValid: false,
                errorMsg: `Unsupported file MIME type (${file.type || 'unknown'}). Must be a valid image.`
            };
        }

        if (file.size > 50 * 1024 * 1024) {
            return {
                isValid: false,
                errorMsg: `File exceeds 50MB maximum limit (${formatBytes(file.size)}).`
            };
        }

        return { isValid: true, errorMsg: null };
    }

    function processIncomingFiles(files) {
        if (!files || files.length === 0) return;

        const newItems = [];
        let newlyAddedCount = 0;

        Array.from(files).forEach(file => {
            const validation = validateFile(file);
            const queueItem = {
                id: 'file_' + Math.random().toString(36).substring(2, 9),
                file: file,
                name: file.name,
                size: file.size,
                type: file.type || ('image/' + getFileExtension(file.name)),
                ext: getFileExtension(file.name),
                isValid: validation.isValid,
                errorMsg: validation.errorMsg,
                status: validation.isValid ? 'pending' : 'error',
                originalDataUrl: null,
                imageObj: null,
                dimensions: 'Pending',
                width: 0,
                height: 0,
                webpBlob: null,
                webpUrl: null,
                webpSize: 0,
                savingsPercent: 0
            };

            newItems.push(queueItem);
            newlyAddedCount++;
        });

        state.filesQueue = [...state.filesQueue, ...newItems];

        // Read data URLs for valid images
        newItems.forEach(item => {
            if (item.isValid) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    item.originalDataUrl = e.target.result;
                    const img = new Image();
                    img.onload = () => {
                        item.imageObj = img;
                        item.width = img.naturalWidth;
                        item.height = img.naturalHeight;
                        item.dimensions = `${img.naturalWidth} × ${img.naturalHeight}`;
                        updateQueueUI();
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(item.file);
            }
        });

        updateQueueUI();
        showToast(`Added ${newlyAddedCount} file(s) to queue`, 'fa-solid fa-plus-circle');
    }

    function updateQueueUI() {
        const totalCount = state.filesQueue.length;
        const validItems = state.filesQueue.filter(item => item.isValid);
        const invalidItems = state.filesQueue.filter(item => !item.isValid);

        // Update badges
        if (queueCountBadge) queueCountBadge.textContent = `${totalCount} File${totalCount !== 1 ? 's' : ''}`;
        if (queueValidBadge) queueValidBadge.textContent = `${validItems.length} Valid`;

        if (invalidItems.length > 0) {
            if (queueInvalidBadge) {
                queueInvalidBadge.textContent = `${invalidItems.length} Unsupported`;
                queueInvalidBadge.classList.remove('hidden');
            }
            renderUnsupportedBanner(invalidItems);
        } else {
            if (queueInvalidBadge) queueInvalidBadge.classList.add('hidden');
            hideErrorBanner();
        }

        // Show/Hide queue container
        if (totalCount > 0) {
            selectedFileCard.classList.remove('hidden');
        } else {
            selectedFileCard.classList.add('hidden');
        }

        // Enable/Disable next button
        nextToStep2Btn.disabled = validItems.length === 0;

        // Render queue list
        renderQueueList();
    }

    function renderUnsupportedBanner(invalidItems) {
        if (!validationBanner || !unsupportedFilesList) return;

        bannerMessage.textContent = `${invalidItems.length} unsupported file(s) detected. Only image files (JPG, PNG, WEBP, BMP, GIF, AVIF) can be processed.`;
        unsupportedFilesList.innerHTML = '';

        invalidItems.forEach(item => {
            const row = document.createElement('div');
            row.className = 'unsupported-item';
            row.innerHTML = `
                <div class="unsupported-item-name">
                    <i class="fa-solid fa-file-circle-xmark" style="color: var(--color-danger-red);"></i>
                    <span>${escapeHtml(item.name)}</span>
                </div>
                <span class="unsupported-tag">${item.ext.toUpperCase()} - Rejected</span>
            `;
            unsupportedFilesList.appendChild(row);
        });

        validationBanner.classList.remove('hidden');
    }

    function renderQueueList() {
        if (!fileQueueList) return;
        fileQueueList.innerHTML = '';

        state.filesQueue.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = `queue-item-card ${!item.isValid ? 'unsupported-card' : ''}`;

            const thumbContent = item.isValid && item.originalDataUrl
                ? `<img src="${item.originalDataUrl}" alt="${escapeHtml(item.name)}">`
                : `<i class="fa-solid ${item.isValid ? 'fa-file-image' : 'fa-file-circle-xmark'} fallback-icon"></i>`;

            const statusBadgeContent = item.isValid
                ? `<span class="status-badge status-valid"><i class="fa-solid fa-check"></i> Valid</span>`
                : `<span class="status-badge status-invalid"><i class="fa-solid fa-triangle-exclamation"></i> Unsupported</span>`;

            card.innerHTML = `
                <div class="queue-item-left">
                    <div class="queue-thumb-box">${thumbContent}</div>
                    <div class="queue-item-details">
                        <span class="queue-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
                        <div class="queue-item-meta">
                            <span>${formatBytes(item.size)}</span>
                            ${item.isValid ? `&bull; <span>${item.dimensions}</span>` : ''}
                        </div>
                        ${!item.isValid ? `<span class="queue-error-text">${escapeHtml(item.errorMsg)}</span>` : ''}
                    </div>
                </div>
                <div class="queue-item-right">
                    ${statusBadgeContent}
                    <button type="button" class="btn-icon-danger remove-queue-btn" data-id="${item.id}" title="Remove file">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;

            fileQueueList.appendChild(card);
        });

        // Add event listeners to remove buttons
        const removeBtns = fileQueueList.querySelectorAll('.remove-queue-btn');
        removeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.getAttribute('data-id');
                removeFromQueue(id);
            });
        });
    }

    function removeFromQueue(id) {
        state.filesQueue = state.filesQueue.filter(item => item.id !== id);
        updateQueueUI();
        showToast('File removed from queue', 'fa-solid fa-trash');
    }

    function clearInvalidFiles() {
        const initialCount = state.filesQueue.length;
        state.filesQueue = state.filesQueue.filter(item => item.isValid);
        const removedCount = initialCount - state.filesQueue.length;

        updateQueueUI();
        hideErrorBanner();
        showToast(`Removed ${removedCount} unsupported file(s)`, 'fa-solid fa-check');
    }

    if (clearInvalidBtn) {
        clearInvalidBtn.addEventListener('click', clearInvalidFiles);
    }

    if (clearAllQueueBtn) {
        clearAllQueueBtn.addEventListener('click', () => {
            state.filesQueue = [];
            updateQueueUI();
            hideErrorBanner();
            showToast('Cleared all files from queue', 'fa-solid fa-broom');
        });
    }

    function escapeHtml(str) {
        return (str || '').replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
    }

    // ----------------------------------------------------------------------
    // 5. Drag & Drop and File Input Event Handlers
    // ----------------------------------------------------------------------

    if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', () => fileInput.click());
    }

    if (addMoreFilesBtn && fileInput) {
        addMoreFilesBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            processIncomingFiles(e.target.files);
            fileInput.value = '';
        });
    }

    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                processIncomingFiles(dt.files);
            }
        });
    }

    // ----------------------------------------------------------------------
    // 6. Step 2 (Batch Quality & Editing Studio)
    // ----------------------------------------------------------------------

    function prepareStep2View() {
        const validItems = state.filesQueue.filter(item => item.isValid);
        if (validItems.length === 0) return;

        // Populate Preview Select Dropdown
        if (previewFileSelect) {
            previewFileSelect.innerHTML = '';
            validItems.forEach((item, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = `${index + 1}. ${item.name} (${formatBytes(item.size)})`;
                previewFileSelect.appendChild(opt);
            });
            previewFileSelect.value = 0;
            state.activePreviewIndex = 0;
        }

        updatePreviewImage();
        calculateBatchEstimations();
    }

    function updatePreviewImage() {
        const validItems = state.filesQueue.filter(item => item.isValid);
        if (validItems.length === 0) return;

        const activeItem = validItems[state.activePreviewIndex] || validItems[0];
        if (!activeItem || !activeItem.originalDataUrl) return;

        qualityPreviewImg.src = activeItem.originalDataUrl;

        let transform = `rotate(${state.rotation}deg)`;
        if (state.flipH) transform += ' scaleX(-1)';
        if (state.flipV) transform += ' scaleY(-1)';

        qualityPreviewImg.style.transform = transform;
        qualityPreviewImg.style.transition = 'transform 0.3s ease';

        if (sourceDimBadge) sourceDimBadge.textContent = `${activeItem.width || 0} × ${activeItem.height || 0} px`;
        if (orientationBadge) {
            const isPortrait = (state.rotation % 180 !== 0)
                ? (activeItem.width > activeItem.height)
                : (activeItem.height > activeItem.width);
            orientationBadge.textContent = isPortrait ? 'Portrait' : 'Landscape';
        }
    }

    function calculateBatchEstimations() {
        const validItems = state.filesQueue.filter(item => item.isValid);
        let totalOriginalBytes = 0;

        validItems.forEach(item => {
            totalOriginalBytes += item.size;
        });

        const qFactor = state.encodingMode === 'lossless' ? 0.92 : (state.qualityValue / 100);
        // Average WebP compression savings baseline
        const estimatedRatio = 0.25 + (0.55 * qFactor);
        const estWebpBytes = totalOriginalBytes * estimatedRatio;
        const totalSavedBytes = totalOriginalBytes - estWebpBytes;
        const totalSavingsPct = Math.max(0, Math.round((totalSavedBytes / totalOriginalBytes) * 100));

        if (estOriginalSize) estOriginalSize.textContent = formatBytes(totalOriginalBytes);
        if (estWebpSize) estWebpSize.textContent = formatBytes(estWebpBytes);
        if (estSavingsChip) estSavingsChip.textContent = `-${totalSavingsPct}% Est. Savings`;
    }

    // Step 2 Controls Event Listeners
    if (previewFileSelect) {
        previewFileSelect.addEventListener('change', (e) => {
            state.activePreviewIndex = parseInt(e.target.value, 10);
            updatePreviewImage();
        });
    }

    if (rotate90Btn) {
        rotate90Btn.addEventListener('click', () => {
            state.rotation = (state.rotation + 90) % 360;
            updatePreviewImage();
        });
    }

    if (flipHBtn) {
        flipHBtn.addEventListener('click', () => {
            state.flipH = !state.flipH;
            updatePreviewImage();
        });
    }

    if (flipVBtn) {
        flipVBtn.addEventListener('click', () => {
            state.flipV = !state.flipV;
            updatePreviewImage();
        });
    }

    if (resetEditBtn) {
        resetEditBtn.addEventListener('click', () => {
            state.rotation = 0;
            state.flipH = false;
            state.flipV = false;
            state.aspectRatio = 'original';
            aspectBtns.forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-aspect') === 'original');
            });
            updatePreviewImage();
            showToast('Reset edits for preview', 'fa-solid fa-rotate-left');
        });
    }

    aspectBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            aspectBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.aspectRatio = btn.getAttribute('data-aspect');
            if (aspectRatioTag) aspectRatioTag.textContent = btn.querySelector('span').textContent;
            updatePreviewImage();
        });
    });

    if (modeLossyBtn && modeLosslessBtn) {
        modeLossyBtn.addEventListener('click', () => {
            modeLossyBtn.classList.add('active');
            modeLosslessBtn.classList.remove('active');
            state.encodingMode = 'lossy';
            calculateBatchEstimations();
        });

        modeLosslessBtn.addEventListener('click', () => {
            modeLosslessBtn.classList.add('active');
            modeLossyBtn.classList.remove('active');
            state.encodingMode = 'lossless';
            calculateBatchEstimations();
        });
    }

    if (qualitySlider && qualityValueText) {
        qualitySlider.addEventListener('input', (e) => {
            state.qualityValue = parseInt(e.target.value, 10);
            qualityValueText.textContent = state.qualityValue;

            presetBtns.forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.getAttribute('data-preset'), 10) === state.qualityValue);
            });

            calculateBatchEstimations();
        });
    }

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const val = parseInt(btn.getAttribute('data-preset'), 10);
            state.qualityValue = val;
            if (qualitySlider) qualitySlider.value = val;
            if (qualityValueText) qualityValueText.textContent = val;
            calculateBatchEstimations();
        });
    });

    if (nextToStep2Btn) {
        nextToStep2Btn.addEventListener('click', () => {
            const validCount = state.filesQueue.filter(i => i.isValid).length;
            if (validCount === 0) return;

            prepareStep2View();
            goToStep(2);
        });
    }

    if (backToStep1Btn) {
        backToStep1Btn.addEventListener('click', () => goToStep(1));
    }

    // ----------------------------------------------------------------------
    // 7. Step 3 (Batch Conversion Engine)
    // ----------------------------------------------------------------------

    function processSingleImageToWebp(queueItem) {
        return new Promise((resolve, reject) => {
            if (!queueItem.imageObj) {
                const img = new Image();
                img.onload = () => {
                    queueItem.imageObj = img;
                    convertCanvas(queueItem, resolve, reject);
                };
                img.onerror = () => reject(new Error(`Failed to load ${queueItem.name}`));
                img.src = queueItem.originalDataUrl;
            } else {
                convertCanvas(queueItem, resolve, reject);
            }
        });
    }

    function convertCanvas(queueItem, resolve, reject) {
        try {
            const img = queueItem.imageObj;
            let srcW = img.naturalWidth || img.width;
            let srcH = img.naturalHeight || img.height;

            // Target aspect ratio crop calculation
            let cropW = srcW;
            let cropH = srcH;
            let cropX = 0;
            let cropY = 0;

            if (state.aspectRatio === 'landscape') {
                const targetRatio = 16 / 9;
                if (srcW / srcH > targetRatio) {
                    cropW = srcH * targetRatio;
                    cropX = (srcW - cropW) / 2;
                } else {
                    cropH = srcW / targetRatio;
                    cropY = (srcH - cropH) / 2;
                }
            } else if (state.aspectRatio === 'portrait') {
                const targetRatio = 9 / 16;
                if (srcW / srcH > targetRatio) {
                    cropW = srcH * targetRatio;
                    cropX = (srcW - cropW) / 2;
                } else {
                    cropH = srcW / targetRatio;
                    cropY = (srcH - cropH) / 2;
                }
            } else if (state.aspectRatio === 'square') {
                const minSide = Math.min(srcW, srcH);
                cropW = minSide;
                cropH = minSide;
                cropX = (srcW - minSide) / 2;
                cropY = (srcH - minSide) / 2;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const rad = (state.rotation * Math.PI) / 180;
            const is90or270 = (state.rotation / 90) % 2 !== 0;

            canvas.width = is90or270 ? cropH : cropW;
            canvas.height = is90or270 ? cropW : cropH;

            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(rad);

            const scaleH = state.flipH ? -1 : 1;
            const scaleV = state.flipV ? -1 : 1;
            ctx.scale(scaleH, scaleV);

            const drawW = is90or270 ? cropH : cropW;
            const drawH = is90or270 ? cropW : cropH;

            ctx.drawImage(
                img,
                cropX, cropY, cropW, cropH,
                -drawW / 2, -drawH / 2, drawW, drawH
            );
            ctx.restore();

            const qualityParam = state.encodingMode === 'lossless' ? 1.0 : (state.qualityValue / 100);

            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas export returned empty blob'));
                    return;
                }

                queueItem.webpBlob = blob;
                queueItem.webpUrl = URL.createObjectURL(blob);
                queueItem.webpSize = blob.size;

                const savedBytes = queueItem.size - blob.size;
                queueItem.savingsPercent = Math.max(0, Math.round((savedBytes / queueItem.size) * 100));
                queueItem.status = 'done';

                resolve(queueItem);
            }, 'image/webp', qualityParam);

        } catch (err) {
            reject(err);
        }
    }

    async function executeBatchConversion() {
        const validItems = state.filesQueue.filter(item => item.isValid);
        if (validItems.length === 0) return;

        goToStep(3);

        if (batchProgressList) batchProgressList.innerHTML = '';
        if (percentText) percentText.textContent = '0';

        // Set SVG ring circumference
        const radius = 90;
        const circumference = 2 * Math.PI * radius;
        if (progressRingCircle) {
            progressRingCircle.style.strokeDasharray = `${circumference} ${circumference}`;
            progressRingCircle.style.strokeDashoffset = circumference;
        }

        // Render progress list placeholders
        validItems.forEach(item => {
            const row = document.createElement('div');
            row.id = `proc_${item.id}`;
            row.className = 'batch-progress-item';
            row.innerHTML = `
                <span class="batch-item-title">${escapeHtml(item.name)}</span>
                <span class="status-badge status-badge-pending">Pending</span>
            `;
            batchProgressList.appendChild(row);
        });

        let completedCount = 0;

        for (let i = 0; i < validItems.length; i++) {
            const item = validItems[i];
            item.status = 'converting';

            const itemRow = document.getElementById(`proc_${item.id}`);
            if (itemRow) {
                itemRow.className = 'batch-progress-item converting';
                itemRow.querySelector('.status-badge').className = 'status-badge status-badge-converting';
                itemRow.querySelector('.status-badge').textContent = 'Converting...';
            }

            if (processingTitle) processingTitle.textContent = `Converting ${i + 1} of ${validItems.length}: ${item.name}`;

            try {
                await processSingleImageToWebp(item);
            } catch (err) {
                console.error(`Error converting ${item.name}:`, err);
                item.status = 'error';
                item.errorMsg = err.message;
            }

            completedCount++;
            const currentPct = Math.round((completedCount / validItems.length) * 100);

            if (percentText) percentText.textContent = currentPct;
            if (progressRingCircle) {
                const offset = circumference - (currentPct / 100) * circumference;
                progressRingCircle.style.strokeDashoffset = offset;
            }

            if (itemRow) {
                if (item.status === 'done') {
                    itemRow.className = 'batch-progress-item completed';
                    itemRow.querySelector('.status-badge').className = 'status-badge status-valid';
                    itemRow.querySelector('.status-badge').textContent = `Done (${formatBytes(item.webpSize)})`;
                } else {
                    itemRow.className = 'batch-progress-item error';
                    itemRow.querySelector('.status-badge').className = 'status-badge status-invalid';
                    itemRow.querySelector('.status-badge').textContent = 'Failed';
                }
            }

            // Brief async delay for smooth visual animations
            await new Promise(r => setTimeout(r, 120));
        }

        // Generate ZIP file with JSZip
        await buildZipArchive();

        // Render Step 4 Results Screen
        renderStep4Results();
        goToStep(4);
        showToast('Batch conversion & ZIP packaging completed!', 'fa-solid fa-circle-check');
    }

    if (startConvertBtn) {
        startConvertBtn.addEventListener('click', executeBatchConversion);
    }

    // ----------------------------------------------------------------------
    // 8. Step 4 (ZIP Generation & Results Dashboard)
    // ----------------------------------------------------------------------

    async function buildZipArchive() {
        const validDoneItems = state.filesQueue.filter(item => item.isValid && item.status === 'done' && item.webpBlob);
        if (validDoneItems.length === 0 || typeof JSZip === 'undefined') return;

        const zip = new JSZip();
        const folder = zip.folder("bini_webp_converted");

        validDoneItems.forEach(item => {
            const baseName = item.name.replace(/\.[^/.]+$/, "");
            folder.file(`${baseName}.webp`, item.webpBlob);
        });

        try {
            state.zipBlob = await zip.generateAsync({ type: "blob" });
        } catch (err) {
            console.error("ZIP Generation Failed:", err);
            showToast("Failed to generate ZIP archive", "fa-solid fa-triangle-exclamation");
        }
    }

    function renderStep4Results() {
        const validDoneItems = state.filesQueue.filter(item => item.isValid && item.status === 'done');

        let totalOrigBytes = 0;
        let totalWebpBytes = 0;

        validDoneItems.forEach(item => {
            totalOrigBytes += item.size;
            totalWebpBytes += item.webpSize;
        });

        const totalSavedBytes = totalOrigBytes - totalWebpBytes;
        const totalSavedPct = totalOrigBytes > 0 ? Math.max(0, Math.round((totalSavedBytes / totalOrigBytes) * 100)) : 0;

        if (resultOriginalSize) resultOriginalSize.textContent = formatBytes(totalOrigBytes);
        if (resultWebpSize) resultWebpSize.textContent = formatBytes(totalWebpBytes);
        if (resultSavingsPercent) resultSavingsPercent.textContent = `-${totalSavedPct}% Saved`;
        if (resultBatchCount) resultBatchCount.textContent = `${validDoneItems.length} / ${state.filesQueue.length} Files`;

        if (zipSubText) {
            zipSubText.textContent = `ZIP Archive contains ${validDoneItems.length} converted .webp image(s) (${formatBytes(state.zipBlob ? state.zipBlob.size : totalWebpBytes)})`;
        }

        // Render Results Table Breakdown
        if (batchResultsContainer) {
            batchResultsContainer.innerHTML = '';

            validDoneItems.forEach((item, index) => {
                const row = document.createElement('div');
                row.className = 'batch-result-row';

                row.innerHTML = `
                    <div class="result-row-left">
                        <img class="result-thumb" src="${item.webpUrl}" alt="${escapeHtml(item.name)}">
                        <div class="result-row-info">
                            <span class="result-file-name">${escapeHtml(item.name)}</span>
                            <div class="result-file-sizes">
                                <span>Original: ${formatBytes(item.size)}</span> &bull; 
                                <span class="highlight-cyan">WebP: ${formatBytes(item.webpSize)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="result-row-right">
                        <span class="result-savings-tag">-${item.savingsPercent}%</span>
                        <a href="${item.webpUrl}" download="${item.name.replace(/\.[^/.]+$/, "")}.webp" class="btn-icon-download" title="Download single WebP">
                            <i class="fa-solid fa-download"></i> Download WebP
                        </a>
                    </div>
                `;

                batchResultsContainer.appendChild(row);
            });
        }
    }

    // ZIP Download Hero Action Button
    if (downloadZipBtn) {
        downloadZipBtn.addEventListener('click', () => {
            if (!state.zipBlob) {
                showToast("ZIP archive is not ready yet", "fa-solid fa-triangle-exclamation");
                return;
            }

            const link = document.createElement('a');
            link.href = URL.createObjectURL(state.zipBlob);
            link.download = state.zipFileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            showToast("ZIP download started successfully!", "fa-solid fa-file-zipper");
        });
    }

    if (convertAnotherBtn) {
        convertAnotherBtn.addEventListener('click', () => {
            state.filesQueue = [];
            updateQueueUI();
            goToStep(1);
        });
    }

    // Global Key Bindings
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideErrorBanner();
    });
});
