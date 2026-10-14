
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
            try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
            updateQueueUI();
            goToStep(1);
        });
    }

    // Global Key Bindings
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideErrorBanner();
    });
});
