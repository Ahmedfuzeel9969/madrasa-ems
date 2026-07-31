'use strict';

module.exports = [
  {
    featureId: 'registration-drafts',
    label: 'Phase A Draft Admission',
    moduleIds: ['registration'],
    pathPatterns: [/ems-registration-drafts\.js/, /REGISTRATION_PHASEA/],
    flagKeys: ['EMS_REG_DRAFTS_ENABLED'],
    status: 'active'
  },
  {
    featureId: 'ai-assistant-fab',
    label: 'Madrasa AI FAB',
    moduleIds: ['ai-assistant'],
    pathPatterns: [/ems-ai-ui\.js/, /ems-ai-orchestrator\.js/],
    status: 'active'
  },
  {
    featureId: 'ai-studio',
    label: 'AI Analytics Studio',
    moduleIds: ['ai-assistant'],
    pathPatterns: [/ems-ai-studio-ui\.js/, /ems-ai-macro-builders\.js/],
    status: 'active'
  },
  {
    featureId: 'enterprise-search',
    label: 'Enterprise Registration Search',
    moduleIds: ['registration'],
    pathPatterns: [/ems-enterprise-search\.js/],
    status: 'active'
  },
  {
    featureId: 'duplicate-detection',
    label: 'Registration Duplicate Detection',
    moduleIds: ['registration'],
    pathPatterns: [/ems-registration-duplicates\.js/],
    status: 'active'
  },
  {
    featureId: 'registration-audit',
    label: 'Registration Audit Trail',
    moduleIds: ['registration'],
    pathPatterns: [/ems-registration-audit\.js/],
    status: 'active'
  },
  {
    featureId: 'offline-first-sync',
    label: 'Offline-first Cloud Sync',
    moduleIds: ['cloud-sync'],
    pathPatterns: [/sync-engine\.js/],
    status: 'active'
  },
  {
    featureId: 'super-admin-platform',
    label: 'Super Admin Platform',
    moduleIds: ['super-admin'],
    pathPatterns: [/superadmin\.js/, /sa\//],
    status: 'active'
  },
  {
    featureId: 'sa-ai-advisor-cmi',
    label: 'SA AI Advisor Code Memory',
    moduleIds: ['super-admin', 'tests-infra'],
    pathPatterns: [/scripts\/cmi\//, /CMI_/],
    status: 'foundation'
  }
];

function featuresForPath(relPath, registry) {
  registry = registry || module.exports;
  var ids = [];
  registry.forEach(function (f) {
    f.pathPatterns.forEach(function (re) {
      if (re.test(relPath) && ids.indexOf(f.featureId) === -1) ids.push(f.featureId);
    });
  });
  return ids;
}

module.exports.featuresForPath = featuresForPath;
