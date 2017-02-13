Ext.define('ZzacksFeatureDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  color_list: ['#0000ff', '#ff0000', '#c0c000', '#00ffc0'],
  drops: {},
  drop_dates: {},
  histories_cluster_size: 300,
  update_interval: 1 * 60 * 60 * 1000,
  // update_interval: 24 * 60 * 60 * 1000,
  cache_tag: 'cached_data_f_',

  getUserSettingsFields: function() {
    return []
  },

  onSettingsUpdate: function(settings) {
    console.log('Settings update:', settings);
  },

  launch: function() {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    var that = this;
    this.start(function() {
      that.ts = that.getContext().getTimeboxScope();
      that.clean_cached_data(that.ts);
    });
  },

  onTimeboxScopeChange: function(ts) {
    this._mask.show();
    var that = this;
    this.start(function() {
      that.ts = ts;
      that.clean_cached_data(ts);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_releases(that.ts);
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
      html: 'Error: ' + msg
    });
  },

  clean_cached_data: function(ts) {
    var that = this;

    Rally.data.PreferenceManager.load({
      appID: this.getAppId(),
      success: function(prefs) {
        var stale = [];
        Object.keys(prefs).forEach(function(p) {
          if (p.substr(0, 14) == that.cache_tag) {
            var last_update = new Date(JSON.parse(prefs[p]).date);
            if (new Date() - last_update > that.update_interval) {
              stale.push(p);
            }
          }
        });

        that.delete_prefs(stale, ts);
      }
    });
  },

  delete_prefs: function(stale, ts) {
    if (stale.length > 0) {
      var that = this;
      Rally.data.PreferenceManager.remove({
        appID: this.getAppId(),
        filterByName: stale[0],
        success: function() {
          stale.shift();
          that.delete_prefs(stale, ts);
        }
      });
    } else {
      this.check_cached_data(ts);
    }
  },

  check_cached_data: function(ts) {
    var that = this;
    var release = ts.record.raw.Name;
    var team = this.getContext().getProject().ObjectID;

    Rally.data.PreferenceManager.load({
      appID: this.getAppId(),
      success: function(prefs) {
        that.prefs = prefs;
        var key = that.cache_tag + team + '_' + release;
        if (prefs[key]) {
          var cd = JSON.parse(prefs[key]);
          var last_update = new Date(cd.date);
          if (new Date() - last_update < that.update_interval) {
            that.colors = cd.colors;
            that.drop_dates = cd.drop_dates;
            that.releases = cd.releases;
            that.removeAll();
            that.create_options(cd.deltas, 'Total points');
          } else {
            that.fetch_releases(ts);
          }
        } else {
          that.fetch_releases(ts);
        }
      }
    });
  },

  fetch_releases: function(ts) {
    this._mask.msg = 'Fetching releases...';
    this._mask.show();

    var that = this;

    this.releases = [];

    var store = Ext.create('Rally.data.wsapi.Store', {
      model: 'Release',
      limit: 1000
    }, this);
    store.load({
      scope: this,
      callback: function(records, operation) {
        if (operation.wasSuccessful()) {
          var record_names = [];
          records.forEach(function(r) {
            if (!record_names[r.get('Name')]) {
              record_names[r.get('Name')] = true;
              that.releases.push({
                name: r.get('Name'),
                start_date: r.get('ReleaseStartDate'),
                end_date: r.get('ReleaseDate')
              });
            }
          });

          that.releases = that.releases.sort(function(a, b) {
            return b.name.localeCompare(a.name);
          });

          var this_release_index = 0;
          for (var i = 0; i < that.releases.length; i += 1) {
            if (that.releases[i].name == ts.record.raw.Name) {
              this_release_index = i;
            }
          }

          that.releases = that.releases.slice(this_release_index, this_release_index + 4);

          that.colors = {};
          for (var i = 0; i < that.releases.length; i += 1) {
            that.colors[that.releases[i].name] = that.color_list[i];
          }

          that.fetch_committed_features(
            that.releases.map(function(r) { return r.name; }),
            [], {}
          );
        } else {
          console.log(':(');
        }
      }
    });
  },

  fetch_committed_features: function(release_names, features, release_lookups) {
    this._mask.msg = 'Fetching features... (' + release_names.length + ' releases left)';
    this._mask.show();

    var that = this;
    
    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: ['Name', 'Release'],
      filters: [
        {
          property: 'Release.Name',
          value: release_names[0]
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Committed features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');
        if (operation.wasSuccessful()) {
          records.forEach(function(r) {
            release_lookups[r.get('Name')] = release_names[0];
          });
          features = features.concat(records);
        }
        release_names.shift();

        if (release_names.length > 0) {
          this.fetch_committed_features(release_names, features, release_lookups);
        } else {
          this.fetch_unscheduled_features(features, release_lookups, 0, []);
        }
      }
    });
  },

  fetch_unscheduled_features: function(features, release_lookups, index, unsched_features) {
    this._mask.msg = 'Fetching unscheduled features...';
    this._mask.show();
    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: ['Name', 'Release', 'ObjectID', 'FormattedID', 'RevisionHistory'],
      filters: [
        {
          property: 'Release.Name',
          value: null
        },
        {
          property: 'LastUpdateDate',
          operator: '>=',
          value: that.releases[index].start_date
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      limit: 1500,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Unscheduled features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          unsched_features = unsched_features.concat(records);
        }

        if (index + 1 < that.releases.length) {
          that.fetch_unscheduled_features(features, release_lookups, index + 1, unsched_features);
        } else {
          that.fetch_unschedule_dates(features, release_lookups, unsched_features);
        }
      }
    });
  },

  fetch_unschedule_dates(features, release_lookups, unsched_features) {
    this._mask.msg = 'Calculating unscheduled feature dates... (' + unsched_features.length + ' features left)';
    this._mask.show();
    var that = this;

    var store = Ext.create('Rally.data.wsapi.Store', {
      model: 'Revision',
      fetch: ['Description', 'CreationDate'],
      filters: [
        {
          property: 'RevisionHistory.ObjectID',
          value: unsched_features[0].get('RevisionHistory')
            ._ref.split('/').reverse()[0]
        }
      ],
      sorters: [
        {
          property: 'RevisionNumber',
          direction: 'ASC'
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Unscheduled dates query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');
        var relevant = false;
        if (operation.wasSuccessful()) {
          var r_filt = records.filter(function(r) {
            return r.get('Description').match(/RELEASE removed/);
          });
          
          if (r_filt.length > 0) {
            relevant = true;
            r_filt.forEach(function(r) {
              release_lookups[unsched_features[0].get('Name')] = 
                r.get('Description').match(/RELEASE removed \[(.*?)\]/)[1];
              that.drops[unsched_features[0].get('ObjectID')] = 
                r.get('CreationDate').toDateString();
              that.drop_dates[r.get('CreationDate').toDateString()] = 
                unsched_features[0].get('FormattedID') + ': ' + unsched_features[0].get('Name');
            });
          }
        }

        if (relevant) {
          features.push(unsched_features.shift());
        } else {
          unsched_features.shift();
        }
        if (unsched_features.length > 0) {
          this.fetch_unschedule_dates(features, release_lookups, unsched_features);
        } else {
          this.fetch_stories(features, [], release_lookups);
        }
      }
    });
  },

  fetch_stories: function(features, stories, release_lookups) {
    this._mask.msg = 'Fetching stories... (' + features.length + ' features left)';
    this._mask.show();

    var feature_oids = features.splice(0, 50).map(function(f) {
      return f.get('ObjectID');
    });

    var that = this;
    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      filters: [
        {
          property: 'Feature.ObjectID',
          operator: 'in',
          value: feature_oids
        },
        {
          property: 'DirectChildrenCount',
          value: 0
        }
      ],
      limit: 2000
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');
        if (operation.wasSuccessful()) {
          stories = stories.concat(records);
        }

        if (features.length > 0) {
          this.fetch_stories(features, stories, release_lookups);
        } else {
          this.fetch_histories(stories, 0, {}, release_lookups);
        }
      }
    });
  },

  fetch_histories: function(stories, index, release_dates, release_lookups) {
    this._mask.msg = 'Fetching story histories... (' + (stories.length - index) + ' stories left)';
    this._mask.show();

    var story_oids = stories.slice(index, index + this.histories_cluster_size)
      .map(function(s) {
        return s.get('ObjectID');
      });

    var that = this;
    var t1 = new Date();
    var store = Ext.create('Rally.data.lookback.SnapshotStore', {
      fetch: [
        'Name', 'FormattedID', 'ScheduleState', 
        '_PreviousValues.ScheduleState', 
        'PlanEstimate', '_ValidFrom'
      ],
      hydrate: ['ScheduleState', '_PreviousValues.ScheduleState'],
      filters: [
        {
          property: 'ObjectID',
          operator: 'in',
          value: story_oids
        }
      ],
      listeners: {
        load: function(store, data, success) {
          var t2 = new Date();
          console.log('Story histories query took', (t2 - t1), 'ms, and retrieved', data ? data.length : 0, 'results.');
          if (success) {
            data.filter(function(d) {
              return (
                (
                  d.get('_PreviousValues.ScheduleState')
                  && d.get('_PreviousValues.ScheduleState').length > 0
                )
                || d.get('_PreviousValues.ScheduleState') === null
              );
            }).forEach(function(d) {
              var fid = d.get('FormattedID');
              if (d.get('ScheduleState') == 'Released') {
                release_dates[fid] = new Date(d.get('_ValidFrom')).toDateString();
              } else {
                delete release_dates[fid];
              }
            });
            
            if (index + that.histories_cluster_size < stories.length) {
              that.fetch_histories(
                stories, 
                index + that.histories_cluster_size, 
                release_dates, 
                release_lookups
              );
            } else {
              that.construct_series(
                release_dates, 
                stories, 
                release_lookups
              );
            }
          }
        }
      }
    });
    t1 = new Date();
    store.load({ scope: this });
  },

  construct_series: function(release_dates, stories, release_lookups) {
    var that = this;
    var deltas = {};

    this.releases.forEach(function(r) {
      var r_deltas = {};
      var now = new Date();
      if (new Date(r.end_date) < now) {
        now = new Date(r.end_date);
      }
      for (var d = new Date(r.start_date); d <= now; d.setDate(d.getDate() + 1)) {
        r_deltas[d.toDateString()] = {
          rp: 0,
          cp: 0,
          rs: 0,
          cs: 0
        };
      }
      deltas[r.name] = r_deltas;
    });

    var dedupe = function(i) {
      for (var j = i + 1; j < stories.length; j += 1) {
        if (stories[i].get('FormattedID') == stories[j].get('FormattedID')) {
          stories.splice(j, 1);
          j -= 1;
        }
      }

      if (i + 1 < stories.length) {
        setTimeout(function() {
          dedupe(i + 1);
        }, 0);
      }
    };
    dedupe(0);

    stories.forEach(function(s) {
      var release = release_lookups[s.get('Feature').Name];
      if (deltas[release]) {
        var first_date = Object.keys(deltas[release])[0];
        var r_date = release_dates[s.get('FormattedID')];
        var c_date = s.get('CreationDate').toDateString();
        var drop = that.drops[s.get('Feature').ObjectID];

        if (r_date) {
          if (deltas[release][r_date]) {
            deltas[release][r_date].rp += s.get('PlanEstimate');
            deltas[release][r_date].rs += 1;
          } else if (new Date(r_date) < new Date(first_date)) {
            deltas[release][first_date].rp += s.get('PlanEstimate');
            deltas[release][first_date].rs += 1;
          }

          if (drop && deltas[release][drop] && new Date(drop) >= new Date(r_date)) {
            deltas[release][drop].rp -= s.get('PlanEstimate');
            deltas[release][drop].rs -= 1;
          }
        }

        if (c_date) {
          if (deltas[release][c_date]) {
            deltas[release][c_date].cp += s.get('PlanEstimate');
            deltas[release][c_date].cs += 1;
          } else if (new Date(c_date) < new Date(first_date)) {
            deltas[release][first_date].cp += s.get('PlanEstimate');
            deltas[release][first_date].cs += 1;
          }

          if (drop && deltas[release][drop] && new Date(drop) >= new Date(c_date)) {
            deltas[release][drop].cp -= s.get('PlanEstimate');
            deltas[release][drop].cs -= 1;
          }
        }
      }
    });

    Object.keys(deltas).forEach(function(r) {
      var r_deltas = deltas[r];
      for (var i = 0; i < Object.keys(r_deltas).length - 1; i += 1) {
        var d_prev = Object.keys(r_deltas)[i];
        var d_next = Object.keys(r_deltas)[i + 1];
        r_deltas[d_next].rp += r_deltas[d_prev].rp;
        r_deltas[d_next].rs += r_deltas[d_prev].rs;
        r_deltas[d_next].cp += r_deltas[d_prev].cp;
        r_deltas[d_next].cs += r_deltas[d_prev].cs;
      }
    });

    var release = this.releases[0].name;
    var team = this.getContext().getProject().ObjectID;
    var key = this.cache_tag + team + '_' + release;
    this.prefs[key] = JSON.stringify({
      date: new Date(),
      colors: this.colors,
      drop_dates: this.drop_dates,
      deltas: deltas,
      releases: this.releases
    });
    Rally.data.PreferenceManager.update({
      appID: this.getAppId(),
      settings: this.prefs,
      success: function(response) {
        if (response[0].errorMessages) {
          console.log('Error saving preferences:', response[0].errorMessages);
        }
        that.removeAll();
        that.create_options(deltas);
      }
    });
  },

  create_options: function(deltas) {
    var that = this;
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_feature()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'rallycombobox',
      itemId: 'graph_select',
      fieldLabel: 'Y-axis:',
      store: ['Total points', 'Total stories/defects'],
      listeners: { change: {
        fn: that.change_graph_type.bind(that)
      }}
    });

    this.deltas = deltas;
    this.build_charts(deltas, 'Total points');
  },

  build_charts: function(deltas, type) {
    this._mask.msg = 'Building chart...';
    this._mask.show();

    var points = type == 'Total points';

    var that = this;
    var series = [];
    Object.keys(deltas).forEach(function(release) {
      var released_config = {
        name: release,
        color: that.colors[release]
      };
      var created_config = {
        name: release + ' Scope',
        color: that.colors[release],
        dashStyle: 'Dot',
        visible: release == that.releases[0].name
      };
      var released_data = [];
      var created_data = [];

      Object.keys(deltas[release]).forEach(function(d) {
        released_data.push({
          y: points ?
            deltas[release][d].rp :
            deltas[release][d].rs,
          date: d,
          drop: that.drop_dates[d] ?
            '<b>' + that.drop_dates[d] + '</b> was unscheduled' :
            ''
        });
        created_data.push({
          y: points ?
            deltas[release][d].cp :
            deltas[release][d].cs,
          date: d,
          drop: that.drop_dates[d] ?
            '<b>' + that.drop_dates[d] + '</b> was unscheduled' :
            ''
        });
      });

      series.push(Object.assign(
        { data: released_data },
        released_config
      ));
      series.push(Object.assign(
        { data: created_data },
        created_config
      ));
    });

    var chart_config = {
      chart: { type: 'line' },
      title: { text: (points ? 'Points' : 'Stories/defects') + ' released for features this quarter' },
      xAxis: { 
        title: { text: 'Days into the quarter' }
      },
      yAxis: { 
        title: { text: 'Total ' + (points ? 'points' : 'artifacts') },
        min: 0
      },
      tooltip: {
        headerFormat: '<span style="font-size: 10px">{series.name}</span><br/>',
        pointFormat: '<b>{point.y} {unit}</b><br />on {point.date}<br />{point.drop}'.replace('{unit}', points ? 'points' : 'artifacts')
      },
      plotOptions: { line: {
        lineWidth: 3,
        marker: { enabled: false }
      }}
    };

    this.chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: {
        series: series.reverse()
      },
      chartConfig: chart_config
    });
     
    this._mask.hide();
    this.locked = false;
  },

  change_graph_type: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.remove(this.chart);
      this.build_charts(this.deltas, new_item);
    }
  }
});
