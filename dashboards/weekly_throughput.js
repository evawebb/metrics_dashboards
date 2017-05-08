Ext.define('ZzacksWeeklyThroughputDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',

  getUserSettingsFields: function() {
    return [];
  },

  onSettingsUpdate: function(settings) {
    console.log('Changed settings:', settings);
  },

  launch: function() {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();
    this.start();
  },

  onTimeboxScopeChange: function(ts) {
    master_release = ts;
  },

  refresh: function() {
    this.start();
  },

  start: function() {
    this.project_oid = this.getContext().getProject().ObjectID;
    var start_date = this.calculate_first_date();
    this.fetch_stories(start_date);
  },

  calculate_first_date: function() {
    var the_date = new Date();
    the_date.setDate(the_date.getDate() - 365);

    while (the_date.getDay() > 0) {
      the_date.setDate(the_date.getDate() - 1);
    }
    the_date.setHours(0, 0, 0, 0);

    return the_date;
  },

  fetch_stories: function(start_date) {
    var that = this;

    var counts = {};
    var date_ranges = [];
    var end_date = new Date(start_date);
    end_date.setDate(end_date.getDate() + 7);
    while (end_date < new Date()) {
      counts[start_date.toDateString()] = {};
      date_ranges.push({
        start: new Date(start_date),
        end: new Date(end_date)
      });
      start_date.setDate(start_date.getDate() + 7);
      end_date.setDate(end_date.getDate() + 7);
    }
    var weeks_remaining = date_ranges.length;

    this._mask.msg = 'Fetching stories... (' + weeks_remaining + ' weeks remaining)';
    this._mask.show();

    date_ranges.forEach(function(dr) {
      var store = Ext.create('Rally.data.wsapi.artifact.Store', {
        models: ['UserStory', 'Defect'],
        filters: [
          {
            property: 'AcceptedDate',
            operator: '>=',
            value: dr.start
          },
          {
            property: 'AcceptedDate',
            operator: '<',
            value: dr.end
          }
        ]
      }, this);
      var t1 = new Date();
      store.load({
        scope: that,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

          weeks_remaining -= 1;
          that._mask.msg = 'Fetching stories... (' + weeks_remaining + ' weeks remaining)';
          that._mask.show();

          if (operation.wasSuccessful()) {
            var d = dr.start.toDateString();
            counts[d] = {
              total_story_pts: 0,
              total_stories: 0,
              total_defect_pts: 0,
              total_defects: 0
            };
            records.forEach(function(r) {
              if (r.get('_type') == 'hierarchicalrequirement') {
                counts[d].total_story_pts += r.get('PlanEstimate');
                counts[d].total_stories += 1;
              } else if (r.get('_type') == 'defect') {
                counts[d].total_defect_pts += r.get('PlanEstimate');
                counts[d].total_defects += 1;
              }
            });
          }

          if (weeks_remaining == 0) {
            that.removeAll();
            that.create_options(counts);
          }
        }
      });
    });
  },

  create_options: function(counts) {
    var that = this;
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="close_weekly()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_weekly()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'rallycombobox',
      itemId: 'mode_select',
      fieldLabel: 'Combine stories & defects?',
      store: ['Separate', 'Combined'],
      listeners: { change: {
        fn: that.change_graph_mode.bind(that)
      }}
    });

    this.counts = counts;
    this.build_graph(counts, 'Separate');
  },

  build_graph(counts, mode) {
    this._mask.msg = 'Building graph...';
    this._mask.show();

    var combined = mode == 'Combined';

    var data = {
      series: [],
      categories: []
    };
    if (!combined) {
      data.series = [
        {
          name: 'Stories',
          data: []
        },
        {
          name: 'Defects',
          data: []
        }
      ];
    } else {
      data.series = [
        {
          name: 'Artifacts',
          data: []
        }
      ];
    }

    Object.keys(counts).forEach(function(d) {
      data.categories.push(d);
      if (!combined) {
        data.series[0].data.push({
          y: counts[d].total_stories,
          date: d,
          unit: 'stories'
        });
        data.series[1].data.push({
          y: counts[d].total_defects,
          date: d,
          unit: 'defects'
        });
      } else {
        data.series[0].data.push({
          y: counts[d].total_stories + counts[d].total_defects,
          date: d,
          unit: 'artifacts'
        });
      }
    });

    this.chart = this.add({
      xtype: 'rallychart',
      chartData: data,
      chartConfig: {
        chart: {
          type: 'line'
        },
        title: { text: 'Stories/defects accepted per week' },
        xAxis: {
          title: { text: 'Week of...' },
          labels: {
            formatter: function() {
              return new Date(this.value).toDateString();
            },
            step: 2,
            rotation: -65
          }
        },
        yAxis: {
          title: { text: 'Artifacts accepted' },
          min: 0
        },
        tooltip: {
          pointFormat:
            '{point.date}<br />' +
            '<b>{point.y} {point.unit}</b>',
          headerFormat: ''
        }
      }
    });

    this._mask.hide();
  },

  change_graph_mode: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.remove(this.chart);
      this.build_graph(this.counts, new_item);
    }
  }
});
