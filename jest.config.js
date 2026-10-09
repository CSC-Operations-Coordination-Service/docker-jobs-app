// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),
  // @grafana/ui and @grafana/data 13 pull in packages that ship ESM only, which
  // the scaffolded list (grafanaESModules) predates: transform them too.
  transformIgnorePatterns: [
    nodeModulesToTransform([
      ...grafanaESModules,
      'marked',
      '@react-hookz/web',
      '@ver0/deep-equal',
      'react-calendar',
      'get-user-locale',
      'memoize',
      'mimic-function',
      '@wojtekmaj/date-utils',
    ]),
  ],
};
