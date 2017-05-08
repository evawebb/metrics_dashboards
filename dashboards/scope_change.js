Ext.define('ZzacksScopeChangeDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  histories_cluster_size: 200,
  colors: [
    '#ffb300', '#803e75', '#ff6800', '#a6bdd7',
    '#c10020', '#cea262', '#817066', '#007d34',
    '#f6768e', '#00538a', '#ff7a5c', '#53377a',
    '#ff8e00', '#b32851', '#f4c800', '#7f180d',
    '#93aa00', '#593315', '#f13a13', '#232c16'
  ],
  percent_renderer: function(v) {
    if (v || v === 0) {
      return '' + v.toFixed(2) + '%';
    } else {
      return '';
    }
  },
  columns: [
    { text: 'Formatted ID',                                      dataIndex: 'fid',              width:  80 },
    { text: 'Name',                                              dataIndex: 'name',             width: 260 },
    { text: 'Refined<br />Estimate',                             dataIndex: 'scope_est',        width:  80 },
    { text: 'Estimated<br />Starting<br />Scope',                dataIndex: 'scope_est_a',      width:  80 },
    { text: 'LBAPI<br />Starting<br />Scope',                    dataIndex: 'scope_est_lb',     width:  80 },
    { text: 'Actual<br />Current Scope',                         dataIndex: 'scope_act',        width:  80 },
    { text: 'Scope Change<br />(Refined Est.)',                  dataIndex: 'scope_chg',        width:  80 },
    { text: 'Percent<br />Scope Change<br />(Refined Estimate)', dataIndex: 'scope_chg_pct',    width: 100, renderer: true },
    { text: 'Scope Change<br />(Estimated)',                     dataIndex: 'scope_chg_a',      width:  80 },
    { text: 'Percent<br />Scope Change<br />(Estimated)',        dataIndex: 'scope_chg_pct_a',  width: 100, renderer: true },
    { text: 'Scope Change<br />(LBAPI)',                         dataIndex: 'scope_chg_lb',     width:  80 },
    { text: 'Percent<br />Scope Change<br />(LBAPI)',            dataIndex: 'scope_chg_pct_lb', width: 100, renderer: true }
  ],

  getUserSettingsFields: function() {
    return [];
  },

  onSettingsUpdate: function(settings) {
    console.log('Settings update:', settings);
  },

  launch: function() {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    var release = master_release || this.getContext().getTimeboxScope();
    var that = this;
    this.start(function() {
      that.release = release;
      that.fetch_features(release);
    });
  },

  onTimeboxScopeChange: function(ts) {
    master_release = ts;
    var that = this;
    this.start(function() {
      that.release = ts;
      that.fetch_features(that.release);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_features(that.release);
    });
  },

  start: function(call_thru) {
    if (this.locked) {
      alert("Please wait for the calculation to finish before starting a new calculation.\n\nIf you tried to change the timebox scope, you will need to re-select the scope you're trying to look at.");
    } else {
      this.locked = true;
      call_thru();
    }
  },

  haltEarly: function(msg) {
    this._mask.hide();
    this.removeAll();
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="close_scope_change()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_scope_change()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
    });
    this.locked = false;
  },

  fetch_features: function(release) {
    this._mask.msg = 'Fetching features...';
    this._mask.show();

    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: ['FormattedID', 'Name', 'RefinedEstimate', 'ObjectID', 'RevisionHistory'],
      filters: [
        {
          property: 'Release.Name',
          value: release.record.raw.Name
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          var data = {};
          records.forEach(function(f) {
            data[f.get('FormattedID')] = {
              name: f.get('Name'),
              scope_est: f.get('RefinedEstimate'),
              scope_est_a: 0,
              scope_act: 0,
              progress: {}
            };
          });

          for (
            var d = new Date(release.record.raw.ReleaseStartDate);
            d < new Date(release.record.raw.ReleaseDate);
            d.setDate(d.getDate() + 1)
          ) {
            records.forEach(function(f) {
              data[f.get('FormattedID')].progress[d.toDateString()] = 0;
            });
          }

          that.fetch_stories(release, records, data);
        } else {
          that.haltEarly('No features found.');
        }
      }
    });
  },

  fetch_stories(release, features, data) {
    var remaining_features = features.length;
    this._mask.msg = 'Fetching stories... (' + remaining_features + ' features remaining)';
    this._mask.show();
    var that = this;

    var feature_clusters = [];
    var i = 0;
    while (i < features.length) {
      feature_clusters.push(features.slice(i, i + 50).map(function(f) {
        return f.get('ObjectID');
      }));
      i += 50;
    }
    var stories = [];

    feature_clusters.forEach(function(c) {
      var store = Ext.create('Rally.data.wsapi.artifact.Store', {
        models: ['UserStory', 'Defect'],
        filters: [
          {
            property: 'Feature.ObjectID',
            operator: 'in',
            value: c
          },
          {
            property: 'DirectChildrenCount',
            value: 0
          }
        ],
        limit: 2000
      }, that);
      var t1 = new Date();
      store.load({
        scope: that,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

          remaining_features -= c.length;
          that._mask.msg = 'Fetching stories... (' + remaining_features + ' features remaining)';
          that._mask.show();

          if (operation.wasSuccessful()) {
            var first_date, second_date, last_date;
            records.forEach(function(s) {
              var ffid = s.get('Feature').FormattedID;
              if (data[ffid]) {
                data[ffid].scope_act += s.get('PlanEstimate');
              } else {
                console.log('Weird story!', s);
              }

              if (!first_date) {
                var k = Object.keys(data[ffid].progress);
                first_date = k[0];
                second_date = k[1];
                last_date = k[k.length - 1];
              }

              var dtds = s.get('CreationDate').toDateString();
              if (data[ffid].progress.hasOwnProperty(dtds)) {
                data[ffid].progress[dtds] += s.get('PlanEstimate');
              } else if (new Date(dtds) < new Date(first_date)) {
                data[ffid].progress[first_date] += s.get('PlanEstimate');
                data[ffid].scope_est_a += s.get('PlanEstimate');
              }
            });
            stories = stories.concat(records);
          }

          if (remaining_features == 0) {
            Object.keys(data).forEach(function(ffid) {
              for (
                var d = new Date(second_date); 
                d <= new Date(last_date); 
                d.setDate(d.getDate() + 1)
              ) {
                var prev = new Date(d);
                prev.setDate(d.getDate() - 1);
                data[ffid].progress[d.toDateString()] += 
                  data[ffid].progress[prev.toDateString()];
              }
            });

            that.fetch_actual_scopes(release, features, stories, data);
          }
        }
      });
    });
  },

  fetch_actual_scopes: function(release, features, stories, data) {
    var remaining_features = features.length;
    var that = this;
    that._mask.msg = 'Fetching starting scopes... (' + remaining_features + ' features remaining)';
    that._mask.show();

    features.forEach(function(f) {
      var t1 = new Date();
      var store = Ext.create('Rally.data.lookback.SnapshotStore', {
        fetch: [
          'Name', 'FormattedID', 'LeafStoryPlanEstimateTotal'
        ],
        hydrate: [],
        filters: [{
          property: 'ObjectID',
          value: f.get('ObjectID')
        }, {
          property: '_ValidFrom',
          operator: '<=',
          value: release.record.raw.ReleaseStartDate
        }, {
          property: '_ValidTo',
          operator: '>=',
          value: release.record.raw.ReleaseStartDate
        }],
        listeners: { load: function(store, lb_data, success) {
          var t2 = new Date();
          console.log('Starting scope query took', (t2 - t1), 'ms, and retrieved', lb_data ? lb_data.length : 0, 'results.');

          if (lb_data.length > 0) {
            data[f.get('FormattedID')].scope_est_lb = lb_data[0].get('LeafStoryPlanEstimateTotal');

            if (lb_data.length > 1) {
              console.log('Warning! Multiple starting scope values returned for ' + f.get('FormattedID') + '.');
            }
          } else {
            data[f.get('FormattedID')].scope_est_lb = 0;

            console.log('Warning! No starting scope values returned for ' + f.get('FormattedID') + '.');
          }

          remaining_features -= 1;
          that._mask.msg = 'Fetching starting scopes... (' + remaining_features + ' features remaining)';
          that._mask.show();

          if (remaining_features == 0) {
            that.fetch_historical_stories(release, features, stories, data);
          }
        }}
      });
      store.load({ scope: that });
    });
  },

  fetch_historical_stories: function(release, features, stories, data) {
    var remaining_features = features.length;
    var that = this;
    that._mask.msg = 'Fetching historical stories... (' + remaining_features + ' features remaining)';
    that._mask.show();

    var up_stories = {};

    features.forEach(function(f) {
      var store = Ext.create('Rally.data.wsapi.Store', {
        model: 'Revision',
        fetch: ['Description', 'CreationDate'],
        filters: [
          {
            property: 'RevisionHistory.ObjectID',
            value: f.get('RevisionHistory')._ref.split('/').reverse()[0]
          }
        ],
        sorters: [
          {
            property: 'RevisionNumber',
            direction: 'ASC'
          }
        ]
      }, that);
      var t1 = new Date();
      store.load({
        scope: that,
        limit: 2000,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Historical stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

          remaining_features -= 1;
          that._mask.msg = 'Fetching historical stories... (' + remaining_features + ' features remaining)';
          that._mask.show();

          if (operation.wasSuccessful()) {
            up_stories[f.get('FormattedID')] = [];
            records.forEach(function(r) {
              if (r.get('Description').indexOf('USERSTORIES removed') != -1) {
                up_stories[f.get('FormattedID')].push(
                  r.get('Description').match(/USERSTORIES removed \[(.*?):.*\]/)[1]
                );
              }
            });
          }

          if (remaining_features == 0) {
            Object.keys(up_stories).forEach(function(ffid) {
              if (up_stories[ffid] == 0) {
                delete up_stories[ffid];
              }
            });
            that.fetch_unparented_stories(release, features, stories, up_stories, data);
          }
        }
      });
    });
  },

  fetch_unparented_stories: function(release, features, stories, up_story_fids, data) {
    var remaining_features = Object.keys(up_story_fids).length;
    var that = this;
    that._mask.msg = 'Fetching unparented stories... (' + remaining_features + ' features remaining)';
    that._mask.show();

    Object.keys(up_story_fids).forEach(function(ffid) {
      var upsf = up_story_fids[ffid];
      var store = Ext.create('Rally.data.wsapi.artifact.Store', {
        models: ['UserStory', 'Defect'],
        filters: [
          {
            property: 'FormattedID',
            operator: 'in',
            value: upsf
          },
          {
            property: 'DirectChildrenCount',
            value: 0
          }
        ],
        limit: 2000
      }, that);
      var t1 = new Date();
      store.load({
        scope: that,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Unparented stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

          remaining_features -= 1;
          that._mask.msg = 'Fetching unparented stories... (' + remaining_features + ' features remaining)';
          that._mask.show();

          if (operation.wasSuccessful()) {
            records.forEach(function(r) {
              data[ffid].scope_est_a += r.get('PlanEstimate');
            });
          }

          if (remaining_features == 0) {
            Object.keys(data).forEach(function(fid) {
              data[fid].scope_chg = data[fid].scope_act - data[fid].scope_est;
              data[fid].scope_chg_a = data[fid].scope_act - data[fid].scope_est_a;
              data[fid].scope_chg_lb = data[fid].scope_act - data[fid].scope_est_lb;
            });

            that.removeAll();
            this.add({
              xtype: 'component',
              html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_scope_change()">Refresh this dashboard</a><hr />'
            });

            var sorted_ffids = that.sort_data(Object.keys(data), data);
            that.build_table(data, sorted_ffids);
            that.build_chart(release, data, sorted_ffids.slice(0, 10));

            this._mask.hide();
            this.locked = false;
          }
        }
      });
    });
  },

  sort_data: function(fids, data) {
    if (fids.length > 1) {
      var pivot = fids[0];
      var left = [];
      var right = [];

      for (var i = 1; i < fids.length; i += 1) {
        if (data[fids[i]].scope_chg_lb > data[pivot].scope_chg_lb) {
          left.push(fids[i]);
        } else {
          right.push(fids[i]);
        }
      }

      left = this.sort_data(left, data);
      right = this.sort_data(right, data);
      return left.concat([pivot]).concat(right);
    } else {
      return fids;
    }
  },

  build_table: function(data, fids) {
    var that = this;
    that._mask.msg = 'Building table...';
    that._mask.show();

    var items = [];
    fids.forEach(function(fid) {
      items.push({
        fid: fid,
        name: data[fid].name,
        scope_est: data[fid].scope_est,
        scope_est_a: data[fid].scope_est_a,
        scope_est_lb: data[fid].scope_est_lb,
        scope_act: data[fid].scope_act,
        scope_chg: data[fid].scope_chg,
        scope_chg_pct: (data[fid].scope_est > 0) ?
          data[fid].scope_chg / data[fid].scope_est * 100 : '',
        scope_chg_a: data[fid].scope_chg_a,
        scope_chg_pct_a: (data[fid].scope_est_a > 0) ?
          data[fid].scope_chg_a / data[fid].scope_est_a * 100 : '',
        scope_chg_lb: data[fid].scope_chg_lb,
        scope_chg_pct_lb: (data[fid].scope_est_lb > 0) ?
          data[fid].scope_chg_lb / data[fid].scope_est_lb * 100 : '',
      });
    });
    var store = Ext.create('Ext.data.Store', {
      fields: Object.keys(items[0]),
      data: { items: items },
      proxy: {
        type: 'memory',
        reader: {
          type: 'json',
          root: 'items'
        }
      }
    });

    var w = 2;
    that.columns.forEach(function(c) { 
      if (c.renderer) {
        c.renderer = that.percent_renderer;
      }
      w += c.width; 
    });
    that.add({
      xtype: 'gridpanel',
      title: 'Scope Change by Feature',
      store: store,
      columns: that.columns,
      width: w
    });
  },

  build_chart: function(release, data, enabled_ffids) {
    var that = this;

    var series = [];
    var categories = [];
    var flag = true;
    var i = 0;
    Object.keys(data).forEach(function(ffid) {
      var f_data = [];
      for (
        var d = new Date(release.record.raw.ReleaseStartDate);
        d < new Date(release.record.raw.ReleaseDate) &&
        d < new Date();
        d.setDate(d.getDate() + 1)
      ) {
        f_data.push(data[ffid].progress[d.toDateString()]);
        if (flag) {
          categories.push(d.toDateString());
        }
      }
      flag = false;

      series.push({
        name: ffid,
        data: f_data,
        color: that.colors[i],
        visible: enabled_ffids.includes(ffid)
      });
      i += 1;
      if (i == that.colors.length) {
        i = 0;
      }
    });

    var chart = that.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: { series: series, categories: categories },
      chartConfig: {
        chart: { type: 'area' },
        title: { text: 'Actual Scope Over Time' },
        xAxis: {
          tickInterval: 7,
          labels: {
            rotation: -20
          }
        },
        yAxis: {
          title: { text: 'Sum of leaf plan estimates (points)' },
          min: 0
        },
        plotOptions: { area: {
          stacking: 'normal',
          marker: { enabled: false }
        } }
      }
    });
  }
});
