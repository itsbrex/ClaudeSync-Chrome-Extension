// popup.js
document.addEventListener("DOMContentLoaded", function () {
	const updateButton = document.getElementById("updateButton");
	const statusElement = document.getElementById("status");
	const tokenInput = document.getElementById("tokenInput");
	const saveTokenBtn = document.getElementById("saveTokenBtn");
	const clearTokenBtn = document.getElementById("clearTokenBtn");
	const tokenIndicator = document.getElementById("tokenIndicator");
	const tokenStatusText = document.getElementById("tokenStatusText");

	// Initialize token status on popup load
	loadTokenStatus();

	function showStatus(message, type = "info") {
		statusElement.textContent = message;
		statusElement.className = `status ${type}`;
		setTimeout(() => {
			statusElement.textContent = "";
			statusElement.className = "";
		}, 5000);
	}

	function updateTokenStatus(hasToken, isValid, username = null, error = null) {
		if (!hasToken) {
			tokenIndicator.className = "status-indicator unknown";
			tokenStatusText.textContent = "Not configured";
			clearTokenBtn.style.display = "none";
			saveTokenBtn.textContent = "Save Token";
		} else if (isValid) {
			tokenIndicator.className = "status-indicator valid";
			tokenStatusText.textContent = username ? `Valid (${username})` : "Valid";
			clearTokenBtn.style.display = "inline-block";
			saveTokenBtn.textContent = "Update Token";
		} else {
			tokenIndicator.className = "status-indicator invalid";
			tokenStatusText.textContent = error ? `Invalid: ${error}` : "Invalid";
			clearTokenBtn.style.display = "inline-block";
			saveTokenBtn.textContent = "Update Token";
		}
	}

	async function loadTokenStatus() {
		try {
			const response = await new Promise((resolve) => {
				chrome.runtime.sendMessage({ action: "getToken" }, resolve);
			});

			if (response.token) {
				// Validate the existing token
				const validation = await new Promise((resolve) => {
					chrome.runtime.sendMessage({ 
						action: "validateToken", 
						token: response.token 
					}, resolve);
				});

				updateTokenStatus(true, validation.valid, validation.user, validation.error);
			} else {
				updateTokenStatus(false, false);
			}
		} catch (error) {
			console.error("Error loading token status:", error);
			updateTokenStatus(false, false, null, "Error loading status");
		}
	}

	saveTokenBtn.addEventListener("click", async function () {
		const token = tokenInput.value.trim();
		
		if (!token) {
			showStatus("Please enter a GitHub access token", "error");
			return;
		}

		saveTokenBtn.disabled = true;
		saveTokenBtn.textContent = "Validating...";

		try {
			// First validate the token
			const validation = await new Promise((resolve) => {
				chrome.runtime.sendMessage({ 
					action: "validateToken", 
					token: token 
				}, resolve);
			});

			if (!validation.valid) {
				showStatus(`Invalid token: ${validation.error}`, "error");
				updateTokenStatus(false, false, null, validation.error);
				return;
			}

			// Save the token if validation passes
			const saveResponse = await new Promise((resolve) => {
				chrome.runtime.sendMessage({ 
					action: "setToken", 
					token: token 
				}, resolve);
			});

			if (saveResponse.success) {
				showStatus("GitHub token saved successfully", "success");
				updateTokenStatus(true, true, validation.user);
				tokenInput.value = ""; // Clear input for security
			} else {
				showStatus("Failed to save token", "error");
			}
		} catch (error) {
			console.error("Error saving token:", error);
			showStatus("Error saving token", "error");
		} finally {
			saveTokenBtn.disabled = false;
			saveTokenBtn.textContent = tokenInput.value ? "Update Token" : "Save Token";
		}
	});

	clearTokenBtn.addEventListener("click", async function () {
		if (!confirm("Are you sure you want to clear the GitHub access token?")) {
			return;
		}

		clearTokenBtn.disabled = true;
		clearTokenBtn.textContent = "Clearing...";

		try {
			const response = await new Promise((resolve) => {
				chrome.runtime.sendMessage({ action: "clearToken" }, resolve);
			});

			if (response.success) {
				showStatus("GitHub token cleared successfully", "success");
				updateTokenStatus(false, false);
				tokenInput.value = "";
			} else {
				showStatus("Failed to clear token", "error");
			}
		} catch (error) {
			console.error("Error clearing token:", error);
			showStatus("Error clearing token", "error");
		} finally {
			clearTokenBtn.disabled = false;
			clearTokenBtn.textContent = "Clear Token";
		}
	});

	updateButton.addEventListener("click", function () {
		chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
			const currentTab = tabs[0];
			if (currentTab.url.startsWith("https://claude.ai/project/")) {
				chrome.tabs.sendMessage(
					currentTab.id,
					{ action: "updateProject" },
					function (response) {
						if (chrome.runtime.lastError) {
							console.error(chrome.runtime.lastError);
							showStatus(
								"Error: Make sure you're on a Claude project page and refresh.",
								"error"
							);
						} else if (response && response.status === "success") {
							showStatus(
								"Update process started successfully.",
								"success"
							);
						} else {
							showStatus(
								"Unknown error occurred. Check console for details.",
								"error"
							);
						}
					}
				);
			} else {
				showStatus(
					"Please navigate to a Claude project page before updating.",
					"error"
				);
			}
		});
	});
});
