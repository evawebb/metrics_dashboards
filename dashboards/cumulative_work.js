Ext.define('ZzacksCumulativeWorkDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
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

    var that = this;
    this.start(function() {
      that.ts = master_release || that.getContext().getTimeboxScope();
      that.release = {
        name: that.ts.record.raw.Name,
        start_date: that.ts.record.raw.ReleaseStartDate,
        end_date: that.ts.record.raw.ReleaseDate
      };
      that.graph_type = 'Total points';
      that.fetch_artifacts([], that.release, 'UserStory', 'Artifact type');
    });
  },

  onTimeboxScopeChange: function(ts) {
    this._mask.show();
    master_release = ts;
    var that = this;
    this.start(function() {
      that.ts = ts;
      that.release = {
        name: that.ts.record.raw.Name,
        start_date: that.ts.record.raw.ReleaseStartDate,
        end_date: that.ts.record.raw.ReleaseDate
      };
      that.fetch_artifacts([], that.release);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_artifacts([], that.release);
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
      html: '<a href="javascript:void(0);" onClick="close_cumulative_work()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_all_work()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
    });
    this.locked = false;
  },

  fetch_artifacts: function(artifacts, release) {
    this._mask.msg = 'Fetching artifacts...';
    this._mask.show();
    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      fetch: ['PlanEstimate', '_type', 'Tags', 'AcceptedDate', 'Feature'],
      filters: [
        {
          property: 'AcceptedDate',
          operator: '>=',
          value: release.start_date
        },
        {
          property: 'AcceptedDate',
          operator: '<',
          value: release.end_date
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
          artifacts = artifacts.concat(records);
          that.fetch_features(artifacts, release);
        } else {
          that.haltEarly('No artifacts found for this release.');
        }
      }
    });
  },

  fetch_features: function(artifacts, release) {
    this._mask.msg = 'Fetching features...';
    this._mask.show();
    var that = this;

    var oids = [];
    artifacts.forEach(function(s) {
      if (s.get('Feature')) {
        var this_oid = parseInt(s.get('Feature')._ref.split('/').reverse()[0]);
        if (!oids.includes(this_oid)) {
          oids.push(this_oid);
        }
      }
    });

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: ['Name', 'ObjectID', 'Release', 'FormattedID'],
      filters: [
        {
          property: 'ObjectID',
          operator: 'in',
          value: oids
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      limit: 200,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        that.assign_types(artifacts, records, release);
      }
    });
  },

  assign_types: function(artifacts, features, release) {
    artifacts.forEach(function(r) {
      var t1 = 't_Artifact type';
      var t2 = 't_Feature';

      if (r.get('_type') == 'hierarchicalrequirement') {
        var this_feature = r.get('Feature');
        if (this_feature) {
          var feature_name = this_feature._refObjectName;
          var full_feature = features.filter(function(f) {
            return f.get('Name') == feature_name;
          })[0];

          if (full_feature) {
            var feature_release = full_feature.get('Release');
            if (feature_release) {
              if (feature_release.Name == release.name) {
                r[t1] = 'Feature story';
              } else {
                r[t1] = 'Unparented story';
              }
            } else {
              r[t1] = 'Unparented story';
            }

            var ffn = full_feature.get('Name');
            if (ffn.length > 30) {
              ffn = ffn.substr(0, 27) + '...';
            }
            r[t2] = full_feature.get('FormattedID') + ': ' + ffn;
          } else {
            r[t1] = 'Unparented story';
            r[t2] = 'No feature';
          }
        } else {
          r[t1] = 'Unparented story';
          r[t2] = 'No feature';
        }
      } else if (r.get('_type') == 'defect') {
        var is_cv = r.get('Tags')._tagsNameArray.filter(function(o) {
          return o.Name == 'Customer Voice';
        }).length > 0;
        var tag_names = r.get('Tags')._tagsNameArray.map(function(o) {
          return o.Name;
        });
        if (is_cv) {
          r[t1] = 'CV defect';
          r[t2] = 'CV defect';
        } else {
          r[t1] = 'Defect';
          r[t2] = 'Defect';
        }
      }
    });

    this.removeAll();
    this.create_options(artifacts, release);
  },

  create_options: function(artifacts, release) {
    var that = this;
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_all_work()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'rallycombobox',
      itemId: 'split_select',
      fieldLabel: 'Categorize artifacts by:',
      store: ['Artifact type', 'Feature'],
      listeners: { change: {
        fn: that.change_split_type.bind(that)
      }}
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

    this.artifacts = artifacts;
    this.release = release;
    this.calculate_deltas(artifacts, release, 'Artifact type');
  },

  calculate_deltas: function(artifacts, release, split_type) {
    this._mask.msg = 'Calculating release deltas...';
    this._mask.show();
    var that = this;

    var deltas = {};
    var now = new Date();
    if (new Date(release.end_date) < now) {
      now = new Date(release.end_date);
    }
    for (var d = new Date(release.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      deltas[d.toDateString()] = {
        ap: {},
        as: {}
      };
    }

    var types = [];
    artifacts.forEach(function(s) {
      var a_date = s.get('AcceptedDate').toDateString();
      var type = s['t_' + split_type];

      if (!types.includes(type)) {
        types.push(type);
      }

      if (a_date && type && deltas[a_date]) {
        if (deltas[a_date].ap[type]) {
          deltas[a_date].ap[type] += s.get('PlanEstimate');
          deltas[a_date].as[type] += 1;
        } else {
          deltas[a_date].ap[type] = s.get('PlanEstimate');
          deltas[a_date].as[type] = 1;
        }
      } else {
        console.log('Weird story!', a_date, type, s);
      }
    });

    var bubble_downs = [
      'Defect',
      'CV defect',
      'Unparented story',
      'No feature'
    ];
    bubble_downs.forEach(function(t) {
      for (var i = types.length - 1; i > 0; i -= 1) {
        if (types[i] == t) {
          types.splice(i - 1, 0, types.splice(i, 1)[0]);
        }
      }
    });

    Object.keys(deltas).forEach(function(d) {
      types.forEach(function(t) {
        if (!deltas[d].ap[t]) {
          deltas[d].ap[t] = 0;
          deltas[d].as[t] = 0;
        }
      });
    });

    var d_first = Object.keys(deltas)[0];
    for (var i = 0; i < Object.keys(deltas).length - 1; i += 1) {
      var d_prev = Object.keys(deltas)[i];
      var d_next = Object.keys(deltas)[i + 1];
      types.forEach(function(t) {
        deltas[d_next].ap[t] += deltas[d_prev].ap[t];
        deltas[d_next].as[t] += deltas[d_prev].as[t];
      });
    }

    if (types.length <= that.colors.length) {
      that.deltas = deltas;
      that.types = types;
      that.build_charts(deltas, types, that.graph_type);
    } else {
      that.haltEarly('Too many categories!');
    }
  },
  
  build_charts: function(deltas, types, graph_type) {
    this._mask.msg = 'Building chart...';
    this._mask.show();
    var that = this;

    var points = graph_type == 'Total points';

    var series = [];
    var i = 0;
    types.forEach(function(t) {
      var data = [];

      Object.keys(deltas).forEach(function(d) {
        data.push({
          y: points ?
            deltas[d].ap[t] :
            deltas[d].as[t],
          date: d,
          x: new Date(d).getTime()
        });
      });

      series.push({
        name: t,
        data: data,
        color: that.colors[i]
      });
      i += 1;
    });

    var chart_config = {
      chart: { type: 'area' },
      xAxis: {
        title: { text: 'Date' },
        max: new Date(Object.keys(deltas)[Object.keys(deltas).length - 1]).getTime(),
        min: new Date(Object.keys(deltas)[0]).getTime(),
        labels: {
          formatter: function() {
            return new Date(this.value).toDateString();
          },
          rotation: -20
        }
      },
      plotOptions: {
        area: {
          stacking: 'normal',
          lineColor: '#000000',
          lineWidth: 1,
          marker: { enabled: false }
        }
      }
    };
    var tooltip_header = '<span style="font-size: 10px">{series.name}</span><br/>';
    var tooltip_point = '<b>{point.y} {unit}</b><br />on {point.date}';

    that.chart = that.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: {
        series: series
      },
      chartConfig: Object.assign(
        {
          title: { text: (points ? 'Points' : 'Stories/defects') + ' accepted per quarter' },
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

    that._mask.hide();
    that.locked = false;
  },

  change_graph_type: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.graph_type = new_item;
      this.remove(this.chart);
      this.build_charts(this.deltas, this.types, new_item);
    }
  },
  
  change_split_type: function(t, new_item, old_item, e) {
    if (old_item) {
      var that = this;
      this.start(function() {
        that.remove(that.chart);
        that.calculate_deltas(that.artifacts, that.release, new_item);
      });
    }
  }
});
