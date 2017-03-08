Ext.define('ZzacksScopeChangeDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  histories_cluster_size: 200,
  colors: [
    '#ffb300',
    '#803e75',
    '#ff6800',
    '#a6bdd7',
    '#c10020',
    '#cea262',
    '#817066',
    '#007d34',
    '#f6768e',
    '#00538a',
    '#ff7a5c',
    '#53377a',
    '#ff8e00',
    '#b32851',
    '#f4c800',
    '#7f180d',
    '#93aa00',
    '#593315',
    '#f13a13',
    '#232c16'
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

    var release = this.getContext().getTimeboxScope();
    var that = this;
    this.start(function() {
      that.release = release;
      that.fetch_features(release);
    });
  },

  onTimeboxScopeChange: function(ts) {
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
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_scope_change()">Refresh this dashboard</a><hr />'
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
              // scope_est_h: 0,
              scope_est_a: 0,
              scope_act: 0,
              scope_chg: -f.get('RefinedEstimate'),
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
    while (features.length > 0) {
      feature_clusters.push(features.splice(0, 50).map(function(f) {
        return f.get('ObjectID');
      }));
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
                data[ffid].scope_chg += s.get('PlanEstimate');
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

            that.removeAll();
            // that.fetch_historical_estimates(release, stories, data);
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

  /* fetch_historical_estimates: function(release, stories, data) {
    var remaining_stories = stories.length;
    this._mask.msg = 'Fetching feature estimates... (' + remaining_stories + ' stories remaining)';
    this._mask.show();
    var that = this;

    var story_clusters = [];
    var feature_fid_clusters = [];
    while (stories.length > 0) {
      var story_cluster = stories.splice(0, that.histories_cluster_size);
      var feature_fid_cluster = {};
      story_cluster.forEach(function(s) {
        feature_fid_cluster[s.get('ObjectID')] = s.get('Feature').FormattedID;
      });
      story_cluster = story_cluster.map(function(s) {
        return s.get('ObjectID');
      });
      story_clusters.push(story_cluster);
      feature_fid_clusters.push(feature_fid_cluster);
    }

    // Thanks, Javascript.
    var indices = [];
    for (var i = 0; i < story_clusters.length; i += 1) {
      indices.push(i);
    }
    indices.forEach(function(i) {
      var story_oids = story_clusters[i];
      var feature_fids = feature_fid_clusters[i];

      var t1;
      var store = Ext.create('Rally.data.lookback.SnapshotStore', {
        fetch: ['Name', 'FormattedID', 'PlanEstimate', 'Feature'],
        hydrate: ['Feature'],
        filters: [
          {
            property: 'ObjectID',
            operator: 'in',
            value: story_oids
          },
          {
            property: '_ValidFrom',
            operator: '>',
            value: release.record.raw.ReleaseStartDate
          },
          {
            property: '_ValidFrom',
            operator: '<',
            value: release.record.raw.ReleaseDate
          }
        ],
        listeners: {
          load: function(store, lb_data, success) {
            var t2 = new Date();
            console.log('Feature estimates query took', (t2 - t1), 'ms, and retrieved', lb_data ? lb_data.length : 0, 'results.');

            remaining_stories -= story_oids.length;
            that._mask.msg = 'Fetching feature estimates... (' + remaining_stories + ' features remaining)';
            that._mask.show();

            var done = {};
            lb_data.forEach(function(m) {
              if (
                !done[m.get('ObjectID')] &&
                m.get('Feature') &&
                feature_fids[m.get('ObjectID')] &&
                data[feature_fids[m.get('ObjectID')]]
              ) {
                data[feature_fids[m.get('ObjectID')]].scope_est_h += m.get('PlanEstimate');
                done[m.get('ObjectID')] = true;
              }
            });

            if (remaining_stories == 0) {
              that.build_table(data, that.sort_data(Object.keys(data), data));
            }
          }
        }
      });
      t1 = new Date();
      store.load({ scope: that });
    });
  }, */

  sort_data: function(fids, data) {
    if (fids.length > 1) {
      var pivot = fids[0];
      var left = [];
      var right = [];

      for (var i = 1; i < fids.length; i += 1) {
        if (data[fids[i]].scope_chg > data[pivot].scope_chg) {
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
    this._mask.msg = 'Building table...';
    this._mask.show();

    var that = this;

    var table = '<div class="center title">Scope Change by Feature</div>' +
      '<table class="center">' +
      '<thead><tr>' + 
      '<th class="bold tablecell">Formatted ID</th>' +
      '<th class="bold tablecell">Name</th>' + 
      '<th class="bold tablecell">Actual Starting Scope</th>' +
      '<th class="bold tablecell">Refined Estimate</th>' + 
      // '<th class="bold tablecell">Refined Estimate (LBAPI)</th>' +
      '<th class="bold tablecell">Actual Current Scope</th>' +
      '<th class="bold tablecell">Scope Change</th>' +
      '<th class="bold tablecell">Percent Scope Change</th>' +
      '</tr></thead>';

    var totals = {
      scope_est: 0,
      // scope_est_h: 0,
      scope_est_a: 0,
      scope_act: 0,
      scope_chg: 0
    };
    fids.forEach(function(fid) {
      table += '<tr>';
      table += '<td class="tablecell center">';
      table += fid + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].name + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_est_a + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_est + '</td>';
      // table += '<td class="tablecell center">';
      // table += data[fid].scope_est_h + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_act + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_chg + '</td>';
      table += '<td class="tablecell center">';
      if (data[fid].scope_est > 0) {
        table += (data[fid].scope_chg / data[fid].scope_est * 100).toFixed(2) + '%</td>';
      } else {
        table += '</td>';
      }
      table += '</tr>';

      Object.keys(totals).forEach(function(k) {
        totals[k] += data[fid][k];
      });
    });
    table += '<tr>';
    table += '<td class="tablecell bold">';
    table += '</td>';
    table += '<td class="tablecell bold">';
    table += 'Total</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_est_a + '</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_est + '</td>';
    // table += '<td class="tablecell bold">';
    // table += totals.scope_est_h + '</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_act + '</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_chg + '</td>';
    table += '<td class="tablecell bold">';
    table += (totals.scope_chg / totals.scope_est * 100).toFixed(2) + '%</td>';
    table += '</tr>';

    table += '</table>';

    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_scope_change()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: table
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
