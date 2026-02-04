(function initCapriConfig(global) {
  var DEFAULT_API_BASE = 'https://capri-store.onrender.com';
  var runtimeConfig = (global.__CAPRI_CONFIG__ && typeof global.__CAPRI_CONFIG__ === 'object') ? global.__CAPRI_CONFIG__ : {};
  var inlineApiBase = typeof global.__CAPRI_API_BASE_URL__ === 'string' ? global.__CAPRI_API_BASE_URL__.trim() : '';

  function normalizeBaseUrl(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    var trimmed = value.trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }
    if (trimmed.endsWith('/')) {
      return trimmed.slice(0, -1);
    }
    return trimmed;
  }

  function resolveConfig() {
    var resolvedApiBase = normalizeBaseUrl(runtimeConfig.apiBaseUrl) || normalizeBaseUrl(inlineApiBase) || DEFAULT_API_BASE;
    return {
      apiBaseUrl: resolvedApiBase
    };
  }

  var capriConfig = resolveConfig();

  function updateConfig(overrides) {
    if (!overrides || typeof overrides !== 'object') {
      return capriConfig;
    }
    if (overrides.apiBaseUrl) {
      var newBase = normalizeBaseUrl(overrides.apiBaseUrl);
      if (newBase) {
        capriConfig.apiBaseUrl = newBase;
      }
    }
    return capriConfig;
  }

  function getConfig() {
    return capriConfig;
  }

  function getApiBaseUrl() {
    return capriConfig.apiBaseUrl;
  }

  function buildApiUrl(pathname) {
    var path = typeof pathname === 'string' ? pathname.trim() : '';
    var normalizedPath = path.startsWith('/') ? path : '/' + path;
    if (!capriConfig.apiBaseUrl) {
      return normalizedPath;
    }
    return capriConfig.apiBaseUrl + normalizedPath;
  }

  global.CapriConfig = {
    getConfig: getConfig,
    getApiBaseUrl: getApiBaseUrl,
    updateConfig: updateConfig,
    buildApiUrl: buildApiUrl
  };
  global.getCapriConfig = getConfig;
  global.getCapriApiBaseUrl = getApiBaseUrl;
  global.buildCapriApiUrl = buildApiUrl;
})(typeof window !== 'undefined' ? window : this);
