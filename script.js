document.addEventListener('DOMContentLoaded', () => {
    
    // =========================================
    // GLOBAL STATE & CONSTANTS
    // =========================================
    const API_CONFIG = {
        effectId: 'removeMustacheFromPhoto',
        model: 'image-effects',
        toolType: 'image-effects',
        userId: 'DObRu1vyStbUynoQmTcHBlhs55z2',
        endpoints: {
            upload: 'https://api.chromastudio.ai/get-emd-upload-url',
            imageGen: 'https://api.chromastudio.ai/image-gen',
            videoGen: 'https://api.chromastudio.ai/video-gen',
            downloadProxy: 'https://api.chromastudio.ai/download-proxy'
        },
        cdnDomain: 'https://contents.maxstudio.ai'
    };

    let currentUploadedUrl = null;

    // =========================================
    // API HELPER FUNCTIONS
    // =========================================

    // Generate nanoid for unique filename
    function generateNanoId(length = 21) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Upload file to CDN storage (called immediately when file is selected)
    async function uploadFile(file) {
        const fileExtension = file.name.split('.').pop() || 'jpg';
        const uniqueId = generateNanoId();
        // Filename is just nanoid.extension (no media/ prefix unless required)
        const fileName = uniqueId + '.' + fileExtension;
        
        // Step 1: Get signed URL from API
        const signedUrlResponse = await fetch(
            `${API_CONFIG.endpoints.upload}?fileName=${encodeURIComponent(fileName)}`,
            { method: 'GET' }
        );
        
        if (!signedUrlResponse.ok) {
            throw new Error('Failed to get signed URL: ' + signedUrlResponse.statusText);
        }
        
        const signedUrl = await signedUrlResponse.text();
        console.log('Got signed URL');
        
        // Step 2: PUT file to signed URL
        const uploadResponse = await fetch(signedUrl, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type
            }
        });
        
        if (!uploadResponse.ok) {
            throw new Error('Failed to upload file: ' + uploadResponse.statusText);
        }
        
        // Step 3: Return download URL
        const downloadUrl = `${API_CONFIG.cdnDomain}/${fileName}`;
        console.log('Uploaded to:', downloadUrl);
        return downloadUrl;
    }

    // Submit generation job (Image or Video)
    async function submitImageGenJob(imageUrl) {
        const isVideo = API_CONFIG.model === 'video-effects';
        const endpoint = isVideo ? API_CONFIG.endpoints.videoGen : API_CONFIG.endpoints.imageGen;
        
        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'sec-ch-ua-platform': '"Windows"',
            'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?0'
        };

        // Construct payload based on type
        let body = {};
        if (isVideo) {
            body = {
                imageUrl: [imageUrl],
                effectId: API_CONFIG.effectId,
                userId: API_CONFIG.userId,
                removeWatermark: true,
                model: 'video-effects',
                isPrivate: true
            };
        } else {
            body = {
                model: API_CONFIG.model,
                toolType: API_CONFIG.toolType,
                effectId: API_CONFIG.effectId,
                imageUrl: imageUrl,
                userId: API_CONFIG.userId,
                removeWatermark: true,
                isPrivate: true
            };
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            throw new Error('Failed to submit job: ' + response.statusText);
        }
        
        const data = await response.json();
        console.log('Job submitted:', data.jobId, 'Status:', data.status);
        return data;
    }

    // Poll job status until completed or failed
    async function pollJobStatus(jobId) {
        const isVideo = API_CONFIG.model === 'video-effects';
        const baseUrl = isVideo ? API_CONFIG.endpoints.videoGen : API_CONFIG.endpoints.imageGen;
        const POLL_INTERVAL = 2000;
        const MAX_POLLS = 60; // 2 minutes
        let polls = 0;
        
        while (polls < MAX_POLLS) {
            const response = await fetch(
                `${baseUrl}/${API_CONFIG.userId}/${jobId}/status`,
                {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json, text/plain, */*'
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error('Failed to check status: ' + response.statusText);
            }
            
            const data = await response.json();
            console.log('Poll', polls + 1, '- Status:', data.status);
            
            if (data.status === 'completed') {
                return data;
            }
            
            if (data.status === 'failed' || data.status === 'error') {
                throw new Error(data.error || 'Job processing failed');
            }
            
            updateStatus('PROCESSING... (' + (polls + 1) + ')');
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            polls++;
        }
        
        throw new Error('Job timed out after ' + MAX_POLLS + ' polls');
    }

    // =========================================
    // UI HELPERS
    // =========================================

    function showLoading() {
        const loader = document.getElementById('loading-state');
        const placeholder = document.getElementById('result-placeholder');
        const resultFinal = document.getElementById('result-final');
        
        if (loader) loader.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (resultFinal) resultFinal.classList.add('hidden');
    }

    function hideLoading() {
        const loader = document.getElementById('loading-state');
        if (loader) loader.classList.add('hidden');
    }

    function updateStatus(text) {
        // Look for a status text element, create if missing inside loader
        let statusText = document.querySelector('.status-text');
        if (!statusText) {
            const loader = document.getElementById('loading-state');
            if (loader) {
                // If there's text inside the loader, update it
                const p = loader.querySelector('p');
                if (p) {
                    p.textContent = text;
                    statusText = p;
                }
            }
        } else {
            statusText.textContent = text;
        }

        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
            if (text.includes('PROCESSING') || text.includes('UPLOADING') || text.includes('SUBMITTING')) {
                generateBtn.disabled = true;
                generateBtn.textContent = text;
            } else if (text === 'READY') {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate';
            } else if (text === 'COMPLETE') {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Again';
            }
        }
    }

    function showError(msg) {
        alert('Error: ' + msg);
        updateStatus('ERROR');
        // Reset button state
        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate';
        }
    }

    function showPreview(url) {
        const img = document.getElementById('preview-image');
        const uploadContent = document.querySelector('#upload-zone .upload-content');
        
        if (img) {
            img.src = url;
            img.classList.remove('hidden');
        }
        if (uploadContent) {
            uploadContent.classList.add('hidden');
        }
    }

    function showResultMedia(url) {
        const resultImg = document.getElementById('result-final');
        const placeholder = document.getElementById('result-placeholder');
        const downloadBtn = document.getElementById('download-btn');
        
        if (placeholder) placeholder.classList.add('hidden');
        
        // Handle Video vs Image
        const isVideo = url.toLowerCase().match(/\.(mp4|webm)(\?.*)?$/i);
        
        if (isVideo) {
            if (resultImg) resultImg.style.display = 'none';
            // Check for existing video or create
            let video = document.getElementById('result-video');
            if (!video) {
                video = document.createElement('video');
                video.id = 'result-video';
                video.controls = true;
                video.autoplay = true;
                video.loop = true;
                video.className = 'w-full h-auto rounded-lg shadow-lg';
                resultImg.parentElement.appendChild(video);
            }
            video.src = url;
            video.style.display = 'block';
            video.classList.remove('hidden');
        } else {
            const video = document.getElementById('result-video');
            if (video) video.style.display = 'none';
            
            if (resultImg) {
                resultImg.src = url + '?t=' + new Date().getTime(); // Prevent caching
                resultImg.classList.remove('hidden');
                resultImg.style.display = 'block';
            }
        }

        if (downloadBtn) {
            downloadBtn.dataset.url = url;
            downloadBtn.disabled = false;
        }
    }

    // =========================================
    // EVENT HANDLERS
    // =========================================

    // Handler when file is selected - uploads immediately
    async function handleFileSelect(file) {
        if (!file.type.startsWith('image/')) {
            alert('Please upload a valid image file (JPG, PNG).');
            return;
        }

        try {
            // UI Updates
            const uploadZone = document.getElementById('upload-zone');
            const previewImage = document.getElementById('preview-image');
            
            // Show local preview immediately while uploading
            const reader = new FileReader();
            reader.onload = (e) => {
                if (previewImage) {
                    previewImage.src = e.target.result;
                    previewImage.classList.remove('hidden');
                }
                const content = uploadZone.querySelector('.upload-content');
                if (content) content.classList.add('hidden');
            };
            reader.readAsDataURL(file);

            updateStatus('UPLOADING...');
            
            // Upload to API
            const uploadedUrl = await uploadFile(file);
            currentUploadedUrl = uploadedUrl;
            
            updateStatus('READY');
            
        } catch (error) {
            console.error(error);
            showError(error.message);
        }
    }

    // Handler when Generate button is clicked
    async function handleGenerate() {
        if (!currentUploadedUrl) {
            alert("Please upload an image first.");
            return;
        }
        
        try {
            showLoading();
            updateStatus('SUBMITTING JOB...');
            
            // Step 1: Submit job
            const jobData = await submitImageGenJob(currentUploadedUrl);
            
            updateStatus('JOB QUEUED...');
            
            // Step 2: Poll for completion
            const result = await pollJobStatus(jobData.jobId);
            
            // Step 3: Extract URL
            const resultItem = Array.isArray(result.result) ? result.result[0] : result.result;
            const resultUrl = resultItem?.mediaUrl || resultItem?.video || resultItem?.image;
            
            if (!resultUrl) {
                throw new Error('No media URL in response');
            }
            
            console.log('Result URL:', resultUrl);
            
            // Step 4: Display
            showResultMedia(resultUrl);
            updateStatus('COMPLETE');
            hideLoading();
            
        } catch (error) {
            hideLoading();
            showError(error.message);
        }
    }

    // =========================================
    // WIRING (DOM ELEMENTS)
    // =========================================
    
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const generateBtn = document.getElementById('generate-btn');
    const resetBtn = document.getElementById('reset-btn');
    const downloadBtn = document.getElementById('download-btn');

    // 1. File Upload Wiring
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                handleFileSelect(e.target.files[0]);
            }
        });
    }

    if (uploadZone) {
        uploadZone.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });
        
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = 'var(--primary)';
            uploadZone.style.background = 'rgba(102, 126, 234, 0.1)';
        });
        
        uploadZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = '';
            uploadZone.style.background = '';
        });
        
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = '';
            uploadZone.style.background = '';
            if (e.dataTransfer.files.length) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    // 2. Generate Button Wiring
    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerate);
    }

    // 3. Download Button Wiring (Robust Proxy Strategy)
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const url = downloadBtn.dataset.url;
            if (!url) return;
            
            const originalText = downloadBtn.textContent;
            downloadBtn.textContent = 'Downloading...';
            downloadBtn.disabled = true;
            
            function downloadBlob(blob, filename) {
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = filename;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            }
            
            function getExtension(url, contentType) {
                if (contentType) {
                    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
                    if (contentType.includes('png')) return 'png';
                }
                const match = url.match(/\.(jpe?g|png|webp|mp4|webm)/i);
                return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
            }
            
            try {
                // STRATEGY 1: Proxy
                const proxyUrl = `${API_CONFIG.endpoints.downloadProxy}?url=` + encodeURIComponent(url);
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error('Proxy failed');
                
                const blob = await response.blob();
                const ext = getExtension(url, response.headers.get('content-type'));
                downloadBlob(blob, 'result_' + generateNanoId(8) + '.' + ext);
                
            } catch (proxyErr) {
                console.warn('Proxy failed, trying direct fetch');
                // STRATEGY 2: Direct Fetch
                try {
                    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
                    const response = await fetch(fetchUrl, { mode: 'cors' });
                    if (response.ok) {
                        const blob = await response.blob();
                        const ext = getExtension(url, response.headers.get('content-type'));
                        downloadBlob(blob, 'result_' + generateNanoId(8) + '.' + ext);
                        return;
                    }
                    throw new Error('Direct fetch failed');
                } catch (fetchErr) {
                    alert('Download failed due to browser security. Please right-click the image and select "Save Image As".');
                }
            } finally {
                downloadBtn.textContent = originalText;
                downloadBtn.disabled = false;
            }
        });
    }

    // 4. Reset Wiring
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            currentUploadedUrl = null;
            if (fileInput) fileInput.value = '';
            
            // Reset Preview
            const previewImage = document.getElementById('preview-image');
            const uploadContent = document.querySelector('#upload-zone .upload-content');
            if (previewImage) {
                previewImage.src = '';
                previewImage.classList.add('hidden');
            }
            if (uploadContent) uploadContent.classList.remove('hidden');
            
            // Reset Result Area
            const resultFinal = document.getElementById('result-final');
            const placeholder = document.getElementById('result-placeholder');
            const loadingState = document.getElementById('loading-state');
            const video = document.getElementById('result-video');
            
            if (resultFinal) {
                resultFinal.src = '';
                resultFinal.classList.add('hidden');
                resultFinal.style.display = 'none';
            }
            if (video) {
                video.pause();
                video.src = '';
                video.style.display = 'none';
            }
            if (placeholder) placeholder.classList.remove('hidden');
            if (loadingState) loadingState.classList.add('hidden');
            
            // Reset Buttons
            if (generateBtn) {
                generateBtn.disabled = true;
                generateBtn.textContent = 'Generate';
            }
            if (downloadBtn) {
                downloadBtn.disabled = true;
            }
        });
    }

    // =========================================
    // MOBILE MENU (Existing Logic)
    // =========================================
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('header nav');
    
    if (menuToggle && nav) {
        menuToggle.addEventListener('click', () => {
            nav.classList.toggle('active');
            menuToggle.textContent = nav.classList.contains('active') ? '✕' : '☰';
            menuToggle.setAttribute('aria-expanded', nav.classList.contains('active'));
        });
        
        nav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('active');
                menuToggle.textContent = '☰';
            });
        });
    }

    // =========================================
    // MODALS (Existing Logic)
    // =========================================
    const openModalButtons = document.querySelectorAll('[data-modal-target]');
    const closeModalButtons = document.querySelectorAll('[data-modal-close]');
    
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
    }
    
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }
    
    openModalButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const target = button.getAttribute('data-modal-target');
            openModal(target);
        });
    });
    
    closeModalButtons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-modal-close');
            closeModal(target);
        });
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
            document.body.style.overflow = '';
        }
    });

    // =========================================
    // FAQ ACCORDION (Existing Logic)
    // =========================================
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');
        
        question.addEventListener('click', () => {
            const isOpen = item.classList.contains('active');
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
                otherItem.querySelector('.faq-answer').style.maxHeight = null;
            });
            
            if (!isOpen) {
                item.classList.add('active');
                answer.style.maxHeight = answer.scrollHeight + 'px';
            }
        });
    });

    // =========================================
    // SCROLL ANIMATIONS (Existing Logic)
    // =========================================
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    document.querySelectorAll('.glass-card, .step-card, .feature-card, .section-header').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(el);
    });
});