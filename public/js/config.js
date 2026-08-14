// ==============================================================
// CampusConnect - Backend API configuration
// Frontend is served from the SAME origin as the backend
// (backend/public/ folder). We use same-origin so no CORS issues.
// ==============================================================
window.CC_CONFIG = {
  API_URL: (function(){
    // Local dev: connect to local backend on port 5000
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      if (location.port === '5000' || location.port === '') return '';
      return 'http://localhost:5000';
    }
    // Production: same origin (frontend is served by the backend)
    return '';
  })()
};
