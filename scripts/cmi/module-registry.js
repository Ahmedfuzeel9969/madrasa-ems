'use strict';

/** Curated module groupings for CMI roll-ups */
module.exports = [
  {
    moduleId: 'registration',
    labelUr: 'رجسٹریشن',
    pathPatterns: [
      /^admission\.js$/,
      /^registration-ui\.js$/,
      /^ems-registration-/,
      /^cloud\/ems-registration-/,
      /^cloud\/ems-enterprise-search\.js$/
    ],
    entryPoints: ['processRegistration', 'emsRegSaveDraft', 'emsRegLoadDraft']
  },
  {
    moduleId: 'finance',
    labelUr: 'مالیات',
    pathPatterns: [/^finance\.js$/]
  },
  {
    moduleId: 'attendance',
    labelUr: 'حاضری',
    pathPatterns: [/^attendance\.js$/, /^ems-attendance-/]
  },
  {
    moduleId: 'ai-assistant',
    labelUr: 'AI مشیر',
    pathPatterns: [/^cloud\/ems-ai-/, /^functions\/lib\/ai\//]
  },
  {
    moduleId: 'cloud-sync',
    labelUr: 'کلاؤڈ سنک',
    pathPatterns: [/^cloud\/sync-engine\.js$/, /^cloud\/direct-firestore\.js$/, /^cloud\/ems-.*-sync\.js$/]
  },
  {
    moduleId: 'auth-security',
    labelUr: 'تصدیق و سیکیورٹی',
    pathPatterns: [/^auth\.js$/, /^security-/, /^tenant-security\.js$/, /^identity-gate\.js$/]
  },
  {
    moduleId: 'dashboard',
    labelUr: 'ڈیش بورڈ',
    pathPatterns: [/^dashboard\.js$/, /^cloud\/ems-dashboard-stats\.js$/]
  },
  {
    moduleId: 'super-admin',
    labelUr: 'سپر ایڈمن',
    pathPatterns: [/^superadmin\.js$/, /^sa\//, /^functions\/lib\/sa-/]
  },
  {
    moduleId: 'hosting-deploy',
    labelUr: 'ہوسٹنگ و ڈپلائے',
    pathPatterns: [/^scripts\/prepare-hosting\.js$/, /^scripts\/deploy-preflight\.js$/, /^firebase\.json$/]
  },
  {
    moduleId: 'loaders',
    labelUr: 'لوڈرز',
    pathPatterns: [/^ems-post-auth-loader\.js$/, /^ems-lazy-loader\.js$/, /^cloud\/ems-cloud-manifest\.js$/]
  },
  {
    moduleId: 'tests-infra',
    labelUr: 'ٹیسٹ انفراسٹرکچر',
    pathPatterns: [/^tests\//, /^vitest\.config\.js$/, /^playwright\./]
  },
  {
    moduleId: 'functions',
    labelUr: 'کلاؤڈ فنکشنز',
    pathPatterns: [/^functions\//]
  }
];

function moduleForPath(relPath, registry) {
  registry = registry || module.exports;
  for (var i = 0; i < registry.length; i++) {
    var mod = registry[i];
    for (var j = 0; j < mod.pathPatterns.length; j++) {
      if (mod.pathPatterns[j].test(relPath)) return mod.moduleId;
    }
  }
  return null;
}

module.exports.moduleForPath = moduleForPath;
