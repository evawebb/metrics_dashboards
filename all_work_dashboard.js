Ext.define('ZzacksAllWorkDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  color_list: ['#0000ff', '#ff0000', '#c0c000', '#00ffc0'],

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

    this.fetch_releases(this.getContext().getTimeboxScope());
  },

  onTimeboxScopeChange: function(ts) {
    this._mask.show();
    this.fetch_releases(ts);
  },

  haltEarly: function(msg) {
    this._mask.hide();
    this.removeAll();
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
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
          artifacts[type][that.releases[release_index].name] = records;
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
          accepted_pts: {
            UserStory: 0,
            Defect: 0
          },
          accepted_stories: {
            UserStory: 0,
            Defect: 0
          }
        };
      }
      deltas[r.name] = r_deltas;
    });

    Object.keys(artifacts.UserStory).forEach(function(r) {
      artifacts.UserStory[r].forEach(function(s) {
        var a_date = s.get('AcceptedDate').toDateString();
        if (a_date && deltas[r][a_date]) {
          deltas[r][a_date].accepted_pts.UserStory += s.get('PlanEstimate');
          deltas[r][a_date].accepted_stories.UserStory += 1;
        } else {
          console.log('Weird story!', s);
        }
      });
    });

    Object.keys(artifacts.Defect).forEach(function(r) {
      artifacts.Defect[r].forEach(function(s) {
        var a_date = s.get('AcceptedDate').toDateString();
        if (a_date && deltas[r][a_date]) {
          deltas[r][a_date].accepted_pts.Defect += s.get('PlanEstimate');
          deltas[r][a_date].accepted_stories.Defect += 1;
        } else {
          console.log('Weird story!', s);
        }
      });
    });

    Object.keys(deltas).forEach(function(r) {
      var d_first = Object.keys(deltas[r])[0];
      deltas[r][d_first].accepted_pts.Both =
        deltas[r][d_first].accepted_pts.UserStory +
        deltas[r][d_first].accepted_pts.Defect;
      deltas[r][d_first].accepted_stories.Both =
        deltas[r][d_first].accepted_stories.UserStory +
        deltas[r][d_first].accepted_stories.Defect;
      for (var i = 0; i < Object.keys(deltas[r]).length - 1; i += 1) {
        var d_prev = Object.keys(deltas[r])[i];
        var d_next = Object.keys(deltas[r])[i + 1];
        deltas[r][d_next].accepted_pts.UserStory += deltas[r][d_prev].accepted_pts.UserStory;
        deltas[r][d_next].accepted_stories.UserStory += deltas[r][d_prev].accepted_stories.UserStory;
        deltas[r][d_next].accepted_pts.Defect += deltas[r][d_prev].accepted_pts.Defect;
        deltas[r][d_next].accepted_stories.Defect += deltas[r][d_prev].accepted_stories.Defect;
        deltas[r][d_next].accepted_pts.Both =
          deltas[r][d_next].accepted_pts.UserStory +
          deltas[r][d_next].accepted_pts.Defect;
        deltas[r][d_next].accepted_stories.Both =
          deltas[r][d_next].accepted_stories.UserStory +
          deltas[r][d_next].accepted_stories.Defect;
      }
    });

    this.removeAll();
    this.create_options(deltas);
  },

  create_options: function(deltas) {
    var that = this;
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a>'
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
    this.artifact_type = 'UserStory';
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
            deltas[release][d].accepted_pts[artifact_type] :
            deltas[release][d].accepted_stories[artifact_type],
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
    if (artifact_type == 'Defect') {
      title_type = 'Defects';
    } else if (artifact_type == 'Both') {
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
  },

  change_story_types: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      if (new_item == 'Just stories') {
        this.artifact_type = 'UserStory';
        this.remove(this.chart);
        this.build_charts(this.deltas, this.graph_type, 'UserStory');
      } else if (new_item == 'Just defects') {
        this.artifact_type = 'Defect';
        this.remove(this.chart);
        this.build_charts(this.deltas, this.graph_type, 'Defect');
      } else {
        this.artifact_type = 'Both';
        this.remove(this.chart);
        this.build_charts(this.deltas, this.graph_type, 'Both');
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
