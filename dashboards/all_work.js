Ext.define('ZzacksAllWorkDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  color_list: ['#0000ff', '#ff0000', '#c0c000', '#00ffc0'],
  update_interval: 1 * 60 * 60 * 1000,
  // update_interval: 24 * 60 * 60 * 1000,
  cache_tag: 'cached_data_a_',

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
          if (p.substr(0, 11) == that.cache_tag) {
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

    that.releases = [];

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
          for (var i = 0; i < 4; i += 1) {
            that.colors[that.releases[i].name] = that.color_list[i];
          }

          that.fetch_artifacts({
            u: {},
            d: {}
          }, 3, 'UserStory');
        } else {
          console.log(':(');
        }
      }
    });
  },

  fetch_artifacts: function(artifacts, release_index, type) {
    this._mask.msg = 'Fetching artifacts...';
    this._mask.show();

    var that = this;
    var store = Ext.create('Rally.data.wsapi.artifact.Store', { 
      models: [type],
      filters: [
        {
          property: 'AcceptedDate',
          operator: '>=',
          value: that.releases[release_index].start_date
        },
        {
          property: 'AcceptedDate',
          operator: '<',
          value: that.releases[release_index].end_date
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      limit: 1500,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Artifacts query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          var key = (type == 'UserStory') ? 'u' : 'd';
          artifacts[key][that.releases[release_index].name] = records;
        }

        if (release_index > 0) {
          that.fetch_artifacts(artifacts, release_index - 1, type);
        } else {
          if (type == 'UserStory') {
            that.fetch_artifacts(artifacts, that.releases.length - 1, 'Defect');
          } else {
            that.calculate_deltas(artifacts);
          }
        }
      }
    });
  },

  calculate_deltas: function(artifacts) {
    this._mask.msg = 'Calculating release deltas...';
    this._mask.show();

    var that = this;
    var deltas = {};
    that.releases.forEach(function(r) {
      var r_deltas = {};
      var now = new Date();
      if (new Date(r.end_date) < now) {
        now = new Date(r.end_date);
      }
      for (var d = new Date(r.start_date); d <= now; d.setDate(d.getDate() + 1)) {
        r_deltas[d.toDateString()] = {
          ap: {
            u: 0,
            d: 0
          },
          as: {
            u: 0,
            d: 0
          }
        };
      }
      deltas[r.name] = r_deltas;
    });

    Object.keys(artifacts.u).forEach(function(r) {
      artifacts.u[r].forEach(function(s) {
        var a_date = s.get('AcceptedDate').toDateString();
        if (a_date && deltas[r][a_date]) {
          deltas[r][a_date].ap.u += s.get('PlanEstimate');
          deltas[r][a_date].as.u += 1;
        } else {
          console.log('Weird story!', s);
        }
      });
    });

    Object.keys(artifacts.d).forEach(function(r) {
      artifacts.d[r].forEach(function(s) {
        var a_date = s.get('AcceptedDate').toDateString();
        if (a_date && deltas[r][a_date]) {
          deltas[r][a_date].ap.d += s.get('PlanEstimate');
          deltas[r][a_date].as.d += 1;
        } else {
          console.log('Weird story!', s);
        }
      });
    });

    Object.keys(deltas).forEach(function(r) {
      var d_first = Object.keys(deltas[r])[0];
      deltas[r][d_first].ap.b =
        deltas[r][d_first].ap.u +
        deltas[r][d_first].ap.d;
      deltas[r][d_first].as.b =
        deltas[r][d_first].as.u +
        deltas[r][d_first].as.d;
      for (var i = 0; i < Object.keys(deltas[r]).length - 1; i += 1) {
        var d_prev = Object.keys(deltas[r])[i];
        var d_next = Object.keys(deltas[r])[i + 1];
        deltas[r][d_next].ap.u += deltas[r][d_prev].ap.u;
        deltas[r][d_next].as.u += deltas[r][d_prev].as.u;
        deltas[r][d_next].ap.d += deltas[r][d_prev].ap.d;
        deltas[r][d_next].as.d += deltas[r][d_prev].as.d;
        deltas[r][d_next].ap.b =
          deltas[r][d_next].ap.u +
          deltas[r][d_next].ap.d;
        deltas[r][d_next].as.b =
          deltas[r][d_next].as.u +
          deltas[r][d_next].as.d;
      }
    });

    var release = this.releases[0].name;
    var team = this.getContext().getProject().ObjectID;
    var key = this.cache_tag + team + '_' + release;
    this.prefs[key] = JSON.stringify({
      date: new Date(),
      colors: this.colors,
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
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_all_work()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'rallycombobox',
      itemId: 'artifact_select',
      fieldLabel: 'Artifact type(s):',
      store: ['Just stories', 'Just defects', 'Both'],
      listeners: {
        change: {
          fn: that.change_story_types.bind(that)
        }
      }
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
    this.artifact_type = 'u';
    this.graph_type = 'Total points';

    this.build_charts(deltas, this.graph_type, this.artifact_type);
  },

  build_charts: function(deltas, graph_type, artifact_type) {
    this._mask.msg = 'Building chart...';
    this._mask.show();

    var points = graph_type == 'Total points';

    var that = this;
    var series = [];
    Object.keys(deltas).forEach(function(release) {
      var data = [];

      Object.keys(deltas[release]).forEach(function(d) {
        data.push({
          y: points ?
            deltas[release][d].ap[artifact_type] :
            deltas[release][d].as[artifact_type],
          date: d
        });
      });

      series.push({
        name: release,
        color: that.colors[release],
        data: data
      });
    });

    var title_type = 'Stories';
    if (artifact_type == 'd') {
      title_type = 'Defects';
    } else if (artifact_type == 'b') {
      title_type = 'Both';
    }

    var chart_config = {
      chart: { type: 'line' },
      xAxis: { 
        title: { text: 'Days into the quarter' }
      },
      plotOptions: { line: {
        lineWidth: 3,
        marker: { enabled: false }
      }}
    };
    var tooltip_header = '<span style="font-size: 10px">{series.name}</span><br/>';
    var tooltip_point = '<b>{point.y} {unit}</b><br />on {point.date}';

    that.chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: {
        series: series.reverse()
      },
      chartConfig: Object.assign(
        {
          title: { text: (points ? 'Points' : 'Stories/defects') + ' accepted per quarter (' + title_type + ')' },
          yAxis: { 
            title: { text: 'Total ' + (points ? 'points' : 'artifacts') },
            min: 0
          },
          tooltip: {
            headerFormat: tooltip_header,
            pointFormat: tooltip_point.replace('{unit}', points ? 'points' : 'artifacts')
          }
        },
        chart_config
      )
    });

    this._mask.hide();
    this.locked = false;
  },

  change_story_types: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      if (new_item == 'Just stories') {
        this.artifact_type = 'u';
        this.remove(this.chart);
        this.build_charts(this.deltas, this.graph_type, 'u');
      } else if (new_item == 'Just defects') {
        this.artifact_type = 'd';
        this.remove(this.chart);
        this.build_charts(this.deltas, this.graph_type, 'd');
      } else {
        this.artifact_type = 'b';
        this.remove(this.chart);
        this.build_charts(this.deltas, this.graph_type, 'b');
      }
    }
  },

  change_graph_type: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.graph_type = new_item;
      this.remove(this.chart);
      this.build_charts(this.deltas, new_item, this.artifact_type);
    }
  }
});
