import { showToast, invoke } from '../shared/utils.js';

let isSignup = false;

export function initAuth(onLoginSuccess) {
    const authForm = document.getElementById("auth-form");
    const authToggleBtn = document.getElementById("auth-toggle-btn");
    const authSubmitBtn = document.getElementById("auth-submit-btn");
    const usernameGroup = document.getElementById("username-group");
    const authTitle = document.getElementById("auth-title");
    const authSubtitle = document.getElementById("auth-subtitle");
    const authError = document.getElementById("auth-error");

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById("auth-email").value;
            const password = document.getElementById("auth-password").value;
            const username = document.getElementById("auth-username")?.value || "";
            authSubmitBtn.disabled = true;
            try {
                if (isSignup) {
                    await invoke('signup', { username, email, password });
                    showToast("Account created!", "success");
                    isSignup = false;
                    if (authToggleBtn) authToggleBtn.click();
                } else {
                    const response = await invoke('login', { email, password });
                    window.currentUser = response;
                    showToast(`Welcome ${response.username || 'User'}`, "success");
                    if (onLoginSuccess) onLoginSuccess(response);
                }
            } catch (err) {
                if (authError) authError.textContent = typeof err === 'string' ? err : JSON.stringify(err);
                showToast("Auth failed: " + err, "error");
            } finally {
                authSubmitBtn.disabled = false;
            }
        });
    }

    if (authToggleBtn) {
        authToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            isSignup = !isSignup;
            if (isSignup) {
                authTitle.textContent = "Create Account";
                authSubtitle.textContent = "Fill in the details to join XFMail";
                authSubmitBtn.textContent = "Sign Up";
                authToggleBtn.textContent = "Login";
                document.getElementById('toggle-text').textContent = "Already have an account?";
                if (usernameGroup) usernameGroup.style.display = "block";
            } else {
                authTitle.textContent = "Welcome to XFMail";
                authSubtitle.textContent = "Sign in to continue";
                authSubmitBtn.textContent = "Login";
                authToggleBtn.textContent = "Sign up";
                document.getElementById('toggle-text').textContent = "Don't have an account?";
                if (usernameGroup) usernameGroup.style.display = "none";
            }
        });
    }
}
