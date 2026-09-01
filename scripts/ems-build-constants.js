/**
 * Single source of truth for cache-bust / build tags (Priority 2).
 * Tests and scripts import from here instead of hardcoding stale version strings.
 */
'use strict';

module.exports = {
  RELEASE: '20260621-perf5',
  CACHE_BUST: {
    syncHardening: '20260709_phase_a_drafts',
    cursorIdb: '20260708_cursor_idb_v1',
    swUpdate: '20260708_sw_update_v1',
    searchIndex: '20260709_phase_a_drafts',
    offline: '20260628offline5',
    postAuthLoader: '20260901_exams_quarterly_dates_v1',
    core: '20260708_sw_update_v1'
  },
  /** Resolve script path — cloud/ prefix when file lives under cloud/ */
  resolveScriptPath: function (root, name) {
    var fs = require('fs');
    var path = require('path');
    var cloud = path.join(root, 'cloud', name);
    var local = path.join(root, name);
    if (fs.existsSync(cloud)) return cloud;
    if (fs.existsSync(local)) return local;
    return local;
  },
  readScript: function (root, name) {
    var fs = require('fs');
    return fs.readFileSync(this.resolveScriptPath(root, name), 'utf8');
  }
};
