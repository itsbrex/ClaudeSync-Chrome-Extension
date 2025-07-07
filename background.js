console.log("[Background] Background script loading...");

// Token management functions
async function getGitHubToken() {
    try {
        const result = await chrome.storage.local.get('githubToken');
        return result.githubToken || null;
    } catch (error) {
        console.error("[Background] Error getting GitHub token:", error);
        return null;
    }
}

async function setGitHubToken(token) {
    try {
        await chrome.storage.local.set({ githubToken: token });
        console.log("[Background] GitHub token saved successfully");
        return true;
    } catch (error) {
        console.error("[Background] Error saving GitHub token:", error);
        return false;
    }
}

async function clearGitHubToken() {
    try {
        await chrome.storage.local.remove('githubToken');
        console.log("[Background] GitHub token cleared successfully");
        return true;
    } catch (error) {
        console.error("[Background] Error clearing GitHub token:", error);
        return false;
    }
}

async function validateGitHubToken(token) {
    try {
        const response = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log("[Background] Token validation successful for user:", data.login);
            return { valid: true, user: data.login };
        } else {
            console.error("[Background] Token validation failed:", response.status, response.statusText);
            return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
    } catch (error) {
        console.error("[Background] Error validating token:", error);
        return { valid: false, error: error.message };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[Background] Received message:", request);
    
    if (request.action === "fetchGitHub") {
        console.log("[Background] Fetching GitHub files for:", request.repoUrl);
        fetchGitHubFiles(request.repoUrl)
            .then(({ files, excludedFiles, includedFiles }) => {
                console.log("[Background] Fetched files:", files);
                console.log("[Background] Excluded files:", excludedFiles);
                console.log("[Background] Included files:", includedFiles);
                sendResponse({ files: files, excludedFiles: excludedFiles, includedFiles: includedFiles });
            })
            .catch((error) => {
                console.error("[Background] Error fetching GitHub files:", error);
                sendResponse({ error: error.message });
            });
        return true; // Indicates that the response is asynchronous
    }
    
    if (request.action === "getToken") {
        getGitHubToken()
            .then(token => sendResponse({ token: token }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
    
    if (request.action === "setToken") {
        setGitHubToken(request.token)
            .then(success => sendResponse({ success: success }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
    
    if (request.action === "clearToken") {
        clearGitHubToken()
            .then(success => sendResponse({ success: success }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
    
    if (request.action === "validateToken") {
        validateGitHubToken(request.token)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ valid: false, error: error.message }));
        return true;
    }
});

async function fetchGitHubFiles(repoUrl) {
    console.log("[Background] Starting fetchGitHubFiles for:", repoUrl);

    const [, , , owner, repo] = repoUrl.split("/");

    if (!owner || !repo) {
        console.error("[Background] Invalid GitHub URL format");
        throw new Error("Invalid GitHub URL format");
    }

    console.log(`[Background] Owner: ${owner}, Repo: ${repo}`);

    try {
        console.log("[Background] Fetching files recursively...");
        const files = await fetchFilesRecursively(
            `https://api.github.com/repos/${owner}/${repo}/contents`
        );
        console.log("[Background] Fetching excluded files...");
        const excludedFiles = await fetchExcludedFiles(owner, repo);
        console.log("[Background] Fetching included files...");
        const includedFiles = await fetchIncludedFiles(owner, repo);
        console.log("[Background] All files retrieved from GitHub:", files);
        console.log("[Background] Excluded files:", excludedFiles);
        console.log("[Background] Included files:", includedFiles);
        return { files, excludedFiles, includedFiles };
    } catch (error) {
        console.error("[Background] Error in fetchGitHubFiles:", error);
        throw error;
    }
}

async function createAuthHeaders() {
    const token = await getGitHubToken();
    const headers = {
        Accept: "application/vnd.github.v3+json",
    };
    
    if (token) {
        headers.Authorization = `token ${token}`;
        console.log("[Background] Using GitHub token for API authentication");
    } else {
        console.log("[Background] No GitHub token found, using public API access");
    }
    
    return headers;
}

async function fetchFilesRecursively(url) {
    console.log("[Background] Fetching files from:", url);
    const headers = await createAuthHeaders();
    const response = await fetch(url, { headers });

    if (!response.ok) {
        console.error("[Background] HTTP error:", response.status, response.statusText);
        if (response.status === 404) {
            const token = await getGitHubToken();
            if (token) {
                throw new Error(
                    "Repository not found. Please check the repository URL and ensure your GitHub token has access to this repository."
                );
            } else {
                throw new Error(
                    "Repository not found or is private. For private repositories, please configure a GitHub access token in the extension popup."
                );
            }
        } else if (response.status === 401) {
            throw new Error(
                "GitHub API authentication failed. Please check your access token in the extension popup."
            );
        } else if (response.status === 403) {
            const token = await getGitHubToken();
            if (token) {
                throw new Error(
                    "Access forbidden. Please ensure your GitHub token has 'repo' scope for private repository access."
                );
            } else {
                throw new Error(
                    "GitHub API rate limit exceeded. Please configure a GitHub access token for higher rate limits."
                );
            }
        }
        const errorBody = await response.text();
        console.error("[Background] GitHub API Error Response:", errorBody);
        throw new Error(
            `GitHub API responded with status ${response.status}: ${response.statusText}`
        );
    }

    const items = await response.json();
    let files = [];

    for (const item of items) {
        if (item.type === "file") {
            console.log("[Background] Fetching content for file:", item.name);
            const contentResponse = await fetch(item.download_url);
            if (!contentResponse.ok) {
                console.error("[Background] Failed to fetch content for", item.name);
                throw new Error(`Failed to fetch content for ${item.name}`);
            }
            const content = await contentResponse.text();
            files.push({
                name: item.path,
                content: content,
                sha: item.sha,
                lastModified: item.last_modified,
            });
        } else if (item.type === "dir") {
            console.log("[Background] Recursing into directory:", item.name);
            const subFiles = await fetchFilesRecursively(item.url);
            files = files.concat(subFiles);
        }
    }

    return files;
}

async function fetchExcludedFiles(owner, repo) {
    const excludeFileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/exclude_claudsync`;
    console.log("[Background] Fetching exclude file from:", excludeFileUrl);
    try {
        const headers = await createAuthHeaders();
        const response = await fetch(excludeFileUrl, { headers });

        if (!response.ok) {
            if (response.status === 404) {
                console.log("[Background] No exclude_claudsync file found.");
                return [];
            }
            console.error("[Background] Failed to fetch exclude_claudsync file:", response.statusText);
            throw new Error(`Failed to fetch exclude_claudsync file: ${response.statusText}`);
        }

        const data = await response.json();
        const content = atob(data.content);
        const excludedItems = content.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'));
        console.log("[Background] Excluded items:", excludedItems);
        return excludedItems;
    } catch (error) {
        console.error("[Background] Error fetching excluded files:", error);
        return [];
    }
}

async function fetchIncludedFiles(owner, repo) {
    const includeFileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/include_claudsync`;
    console.log("[Background] Fetching include file from:", includeFileUrl);
    try {
        const headers = await createAuthHeaders();
        const response = await fetch(includeFileUrl, { headers });

        if (!response.ok) {
            if (response.status === 404) {
                console.log("[Background] No include_claudsync file found.");
                return [];
            }
            console.error("[Background] Failed to fetch include_claudsync file:", response.statusText);
            throw new Error(`Failed to fetch include_claudsync file: ${response.statusText}`);
        }

        const data = await response.json();
        const content = atob(data.content);
        const includedItems = content.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '' && !line.startsWith('#'));
        console.log("[Background] Included items:", includedItems);
        return includedItems;
    } catch (error) {
        console.error("[Background] Error fetching included files:", error);
        return [];
    }
}

console.log("[Background] Background script loaded");