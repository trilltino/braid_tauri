import { showToast, invoke } from '../shared/utils.js';

let isSignup = false;

export function initAuth(onLoginSuccess) {
    const authForm = document.getElementById("auth-form");
    const authToggleBtn = document.getElementById("auth-toggle-btn");
    const authSubmitBtn = document.getElementById("auth-submit-btn");
    const authBackBtn = document.getElementById("auth-back-btn");
    const authPrefBtn = document.getElementById("auth-pref-btn");
    const prefModal = document.getElementById("pref-modal");
    const prefClose = document.getElementById("pref-close");
    const prefThemeToggle = document.getElementById("pref-theme-toggle");
    const prefServerToggle = document.getElementById("pref-server-toggle");
    const toggleContainer = document.querySelector(".auth-toggle");
    const usernameGroup = document.getElementById("username-group");
    const avatarGroup = document.getElementById("avatar-group");
    const authTitle = document.getElementById("auth-title");
    const authError = document.getElementById("auth-error");
    const avatarDropZone = document.getElementById("avatar-drop-zone");
    const authAvatarHash = document.getElementById("auth-avatar-hash");
    const avatarPreview = document.getElementById("avatar-preview");

    const authSlogan = document.getElementById("auth-slogan");

    // Initially hide titlebar text during splash
    document.body.classList.add('auth-screen-visible');

    const storageSetupGroup = document.getElementById("storage-setup-group");
    const currentStoragePath = document.getElementById("current-storage-path");
    const selectStorageBtn = document.getElementById("select-storage-btn");
    const signupSyncToggle = document.getElementById("signup-sync-toggle");

    let signupStep = 1;
    let selectedBaseDir = "";

    const toggleView = async (signup) => {
        isSignup = signup;
        signupStep = 1;
        if (isSignup) {
            authTitle.textContent = "Create Account";
            authSubmitBtn.textContent = "Next"; // Change from Sign Up to Next
            document.querySelectorAll('.input-group').forEach(group => group.style.display = "block");
            if (avatarGroup) avatarGroup.style.display = "block";
            if (toggleContainer) toggleContainer.style.display = "none";
            if (authBackBtn) authBackBtn.style.display = "flex";
            if (authSlogan) authSlogan.style.display = "none";
            if (storageSetupGroup) storageSetupGroup.style.display = "none";

            // Get default storage base
            try {
                selectedBaseDir = await invoke('get_default_storage_base');
                updateStoragePreview();
            } catch (err) {
                console.error("Failed to get default storage:", err);
            }
        } else {
            if (usernameGroup) usernameGroup.style.display = "none";
            if (avatarGroup) avatarGroup.style.display = "none";
            document.querySelectorAll('.input-group').forEach(group => group.style.display = "block");
            if (usernameGroup) usernameGroup.style.display = "none"; // Hide it again for login
            if (avatarGroup) avatarGroup.style.display = "none"; // Hide it again for login
            if (toggleContainer) toggleContainer.style.display = "block";
            if (authBackBtn) authBackBtn.style.display = "none";
            if (authSlogan) authSlogan.style.display = "block";
            if (storageSetupGroup) storageSetupGroup.style.display = "none";
        }
    };

    const updateStoragePreview = () => {
        const username = document.getElementById("auth-username")?.value || "user";
        if (currentStoragePath) {
            currentStoragePath.textContent = `${selectedBaseDir}\\${username}_local_link`.replace(/\\\\/g, '\\');
        }
    };

    document.getElementById("auth-username")?.addEventListener('input', updateStoragePreview);

    if (selectStorageBtn) {
        selectStorageBtn.addEventListener('click', async () => {
            try {
                const selected = await window.__TAURI__.dialog.open({
                    directory: true,
                    multiple: false,
                    defaultPath: selectedBaseDir
                });
                if (selected) {
                    selectedBaseDir = selected;
                    updateStoragePreview();
                }
            } catch (err) {
                showToast("Folder selection failed", "error");
            }
        });
    }

    if (signupSyncToggle) {
        signupSyncToggle.addEventListener('click', () => {
            signupSyncToggle.classList.toggle('active');
        });
    }

    // Modal Tab Switching
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');

            // Update tabs
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById(target);
            if (content) content.classList.add('active');
        });
    });

    // Close modal on outside click
    if (prefModal) {
        prefModal.addEventListener('click', (e) => {
            if (e.target === prefModal) prefModal.style.display = "none";
        });
    }

    if (prefThemeToggle) {
        prefThemeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-mode');
            prefThemeToggle.classList.toggle('active', isLight);
            // Sync with titlebar toggle
            const titlebarToggle = document.getElementById('theme-toggle');
            if (titlebarToggle) {
                titlebarToggle.classList.toggle('active', isLight);
            }
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
        });
    }

    // Start Chat Slogan Rotation (Inline Logic)

    // Trigger Title Fade In
    setTimeout(() => {
        document.querySelector('.auth-header-brand')?.classList.add('visible');
    }, 100);

    // Global Drag/Drop Prevention (stops browser opening files)
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    // Slogan Logic (Inline)
    const slogans = ['Friends.', 'Family.', 'Colleagues.', 'Groups.', 'Humanity.'];
    let currentSloganIndex = -1;
    let cycleCount = 0;

    const findSloganElements = () => {
        const target = document.getElementById('slogan-target');
        const container = document.getElementById('auth-slogan');
        return { target, container };
    };

    const sloganElements = findSloganElements();

    if (sloganElements.target && sloganElements.container) {
        if (window.sloganInterval) clearInterval(window.sloganInterval);

        const rotate = () => {
            sloganElements.target.classList.add('slogan-fade');

            setTimeout(() => {
                currentSloganIndex = (currentSloganIndex + 1) % slogans.length;
                sloganElements.target.textContent = slogans[currentSloganIndex];
                sloganElements.target.classList.remove('slogan-fade');

                if (currentSloganIndex === slogans.length - 1) {
                    cycleCount++;
                    if (cycleCount >= 2) {
                        clearInterval(window.sloganInterval);
                        setTimeout(() => {
                            sloganElements.container.classList.add('slogan-gone');
                        }, 2000);
                    }
                }
            }, 1000);
        };

        rotate();
        window.sloganInterval = setInterval(rotate, 4000);
    }

    if (prefServerToggle) {
        prefServerToggle.addEventListener('click', () => {
            prefServerToggle.classList.toggle('local');
            const isLocal = prefServerToggle.classList.contains('local');
            showToast(isLocal ? "Local Mode enabled" : "Server Mode enabled", "info");
        });
    }

    // Mock settings toggles
    document.querySelectorAll('.modal-box .theme-switch').forEach(sw => {
        if (sw.id === 'pref-theme-toggle') return;
        sw.addEventListener('click', () => {
            sw.classList.toggle('active');
        });
    });

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById("auth-email").value;
            const password = document.getElementById("auth-password").value;
            const username = document.getElementById("auth-username")?.value || "";
            const avatar_blob_hash = authAvatarHash.value || null;

            authSubmitBtn.disabled = true;
            try {
                if (isSignup) {
                    if (signupStep === 1) {
                        // Validate account details first
                        if (!username || !email || !password) {
                            showToast("Please fill all details", "error");
                            return;
                        }

                        // Move to setup screen
                        authTitle.textContent = "Storage Setup";
                        authSubmitBtn.textContent = "Create Directory";
                        if (usernameGroup) usernameGroup.style.display = "none";
                        if (avatarGroup) avatarGroup.style.display = "none";
                        document.querySelectorAll('.input-group input').forEach(inp => {
                            if (inp.id !== 'auth-username') inp.parentElement.style.display = 'none';
                        });
                        if (storageSetupGroup) storageSetupGroup.style.display = "block";
                        signupStep = 2;
                    } else {
                        // Final signup step: setup storage + create account
                        showToast("Setting up user folder...", "info");
                        const syncWithBraid = signupSyncToggle.classList.contains('active');

                        await invoke('setup_user_storage', {
                            username,
                            basePath: selectedBaseDir,
                            syncWithBraid
                        });

                        // Only call signup if not already logged in (fresh signup)
                        if (!window.currentUser) {
                            const response = await invoke('signup_braid', { username, email, password, avatar_blob_hash });
                            window.currentUser = response;
                        }

                        showToast("Welcome to your new Profile!", "success");

                        // Auto-login / Proceed
                        document.body.classList.remove('auth-screen-visible');
                        if (onLoginSuccess) onLoginSuccess(window.currentUser);
                        toggleView(false); // Reset view state
                    }
                } else {
                    const response = await invoke('login_braid', { email, password });
                    window.currentUser = response;

                    // Check if storage is setup for already created accounts
                    const isSetup = await invoke('is_storage_setup');
                    if (!isSetup) {
                        showToast("Storage setup required for this device", "info");
                        isSignup = true; // Temporary hijack to use the setup screen
                        signupStep = 2;
                        authTitle.textContent = "Storage Setup";
                        authSubmitBtn.textContent = "Create Directory";
                        if (usernameGroup) usernameGroup.style.display = "none";
                        if (avatarGroup) avatarGroup.style.display = "none";
                        document.querySelectorAll('.input-group input').forEach(inp => {
                            if (inp.id !== 'auth-username') inp.parentElement.style.display = 'none';
                        });
                        if (storageSetupGroup) storageSetupGroup.style.display = "block";

                        // Pre-fill username for storage setup (critical for path generation)
                        if (document.getElementById("auth-username")) {
                            document.getElementById("auth-username").value = response.username;
                        }

                        // Prefill base dir
                        try {
                            selectedBaseDir = await invoke('get_default_storage_base');
                            updateStoragePreview();
                        } catch (err) { console.error(err); }

                        return; // Don't proceed to app yet
                    }

                    // Cleanup auth state
                    document.body.classList.remove('auth-screen-visible');
                    // Show title text
                    const titleText = document.getElementById('titlebar-text');
                    if (titleText) titleText.textContent = 'LocalLink.';

                    showToast(`Welcome ${response.username || 'User'}`, "success");
                    if (onLoginSuccess) onLoginSuccess(response);
                }
            } catch (err) {
                if (authError) authError.textContent = typeof err === 'string' ? err : JSON.stringify(err);
                showToast("Action failed: " + err, "error");
            } finally {
                authSubmitBtn.disabled = false;
            }
        });
    }

    // Avatar Drag and Drop
    if (avatarDropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            avatarDropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        avatarDropZone.addEventListener('dragenter', () => avatarDropZone.classList.add('drag-over'));
        avatarDropZone.addEventListener('dragover', () => avatarDropZone.classList.add('drag-over'));
        avatarDropZone.addEventListener('dragleave', () => avatarDropZone.classList.remove('drag-over'));
        avatarDropZone.addEventListener('drop', async (e) => {
            avatarDropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                // Upload to Braid blobs immediately
                try {
                    showToast("Uploading avatar...", "info");

                    const reader = new FileReader();
                    reader.onload = (env) => {
                        avatarPreview.style.backgroundImage = `url(${env.target.result})`;
                        avatarDropZone.classList.add('has-image');
                    };
                    reader.readAsDataURL(file);

                    // In a real implementation, we would send the bytes to the server
                    authAvatarHash.value = "avatar_" + Date.now();
                } catch (err) {
                    showToast("Avatar upload failed", "error");
                }
            }
        });
    }

    if (authToggleBtn) {
        authToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleView(true);
        });
    }

    if (authBackBtn) {
        authBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isSignup && signupStep === 2) {
                toggleView(true); // Reset to step 1
            } else {
                toggleView(false);
            }
        });
    }

    if (authPrefBtn) {
        authPrefBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (prefModal) prefModal.style.display = 'flex';
        });
    }

    // Nav Profile Button & Modal Logic
    const profileEditModal = document.getElementById('profile-edit-modal');
    const profileClose = document.getElementById('profile-close');
    const logoutBtn = document.getElementById('logout-btn');
    const saveProfileBtn = document.getElementById('save-profile-btn');

    if (profileClose) {
        profileClose.addEventListener('click', () => {
            if (profileEditModal) profileEditModal.style.display = 'none';
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            showToast("Logging out...", "info");
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        });
    }

    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', () => {
            const newName = document.getElementById('edit-profile-username')?.value;
            if (newName) {
                authTitle.setAttribute('data-current-user', newName);
                showToast("Profile updated", "success");
                if (profileEditModal) profileEditModal.style.display = 'none';
            }
        });
    }
}
