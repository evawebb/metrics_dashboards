Ext.define('ZzacksTeamProgressDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  
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
      that.first_run = true;
      that.ts = that.getContext().getTimeboxScope();
      that.fetch_iterations(that.ts, []);
    });
  },

  onTimeboxScopeChange: function(ts) {
    var that = this;
    this.start(function() {
      that.first_run = true;
      that.ts = ts;
      that.fetch_iterations(ts, []);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.first_run = true;
      that.fetch_iterations(that.ts, []);
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

  fetch_iterations: function(ts, excluded_its) {
    this._mask.msg = 'Fetching iterations...';
    this._mask.show();
    var that = this;

    that.start_date = ts.record.raw.ReleaseStartDate;
    that.end_date = ts.record.raw.ReleaseDate;

    var store = Ext.create('Rally.data.wsapi.Store', {
      model: 'Iteration',
      filters: [
        {
          property: 'StartDate',
          operator: '>=',
          value: that.start_date
        },
        {
          property: 'StartDate',
          operator: '<',
          value: that.end_date
        }
      ],
      sorters: [
        {
          property: 'StartDate',
          direction: 'ASC'
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Iterations query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          that.fetch_stories(records, excluded_its);
        }
      }
    });
  },

  fetch_stories: function(iterations, excluded_its) {
    this._mask.msg = 'Fetching stories...';
    this._mask.show();
    var that = this;

    var stories = [];
    var remaining_iterations = iterations.length;

    iterations.forEach(function(it) {
      var store = Ext.create('Rally.data.wsapi.artifact.Store', {
        models: ['UserStory', 'Defect'],
        filters: [
          {
            property: 'Iteration.Name',
            value: it.get('Name')
          }
        ]
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

          remaining_iterations -= 1;
          if (remaining_iterations == 0) {
            that.removeAll();
            that.create_options(iterations, stories, excluded_its);
          }
        }
      });
    });
  },

  create_options: function(iterations, stories, excluded_its) {
    var that = this;

    var lt = that.first_run ? 'Show iteration selector' : 'Hide iteration selector';
    that.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_team_progress()">Refresh this dashboard</a><br /><a id="iteration_toggle_link" href="javascript:void(0);" onclick="toggle_iteration_settings()">' + lt + '</a>'
    });

    var checkboxes = [];
    iterations.forEach(function(it) {
      checkboxes.push({
        xtype: 'rallycheckboxfield',
        fieldLabel: it.get('Name'),
        value: !excluded_its.includes(it.get('Name')),
        listeners: { change: {
          fn: function(t, new_item, old_item, e) {
            that.select_iterations(t.fieldLabel, new_item, old_item, excluded_its);
          }.bind(that)
        } }
      });
    });
    that.settings_container = that.add({
      xtype: 'container',
      items: checkboxes
    });
    if (that.first_run) {
      that.settings_container.hide();
      that.first_run = false;
    }

    that.add({
      xtype: 'component',
      html: '<hr />'
    });

    that.construct_data(iterations, stories, excluded_its);
  },
  
  construct_data: function(iterations, stories, excluded_its) {
    this._mask.msg = 'Constructing data...';
    this._mask.show();
    var that = this;

    var data = {
      total: 0,
      total_planned: 0,
      accepted: {},
      capacities: [],
      progress: {}
    };

    for (var i = 0; i < iterations.length; i += 1) {
      if (i < iterations.length - 1) {
        iterations[i].data.EndDate = iterations[i + 1].get('StartDate');
      } else {
        iterations[i].data.EndDate = new Date(that.end_date);
      }
    }

    var filtered_its = iterations.filter(function(it) {
      return !excluded_its.includes(it.get('Name'));
    });

    iterations.forEach(function(it) {
      if (filtered_its.includes(it)) {
        data.accepted[it.get('Name')] = {
          amt: 0,
          start: it.get('StartDate'),
          end: it.get('EndDate')
        };
      }

      data.capacities.push({
        c: it.get('PlannedVelocity'),
        d: it.get('StartDate').toDateString()
      });
    });

    for (var d = new Date(that.start_date); d <= new Date(that.end_date); d.setDate(d.getDate() + 1)) {
      data.progress[d.toDateString()] = 0;
    }

    var first_date = new Date(that.start_date).toDateString();
    stories.forEach(function(s) {
      data.total += s.get('PlanEstimate');

      if (s.get('ScheduleState') == 'Released' || s.get('ScheduleState') == 'Accepted') {
        var a_date = s.get('AcceptedDate');

        if (s.get('Feature')) {
          data.total_planned += s.get('PlanEstimate');

          Object.keys(data.accepted).forEach(function(it) {
            var r = data.accepted[it];
            if (r.start <= a_date && a_date < r.end) {
              r.amt += s.get('PlanEstimate');
            }
          });
        }

        a_date = a_date.toDateString();
        if (data.progress.hasOwnProperty(a_date)) {
          data.progress[a_date] += s.get('PlanEstimate');
        } else if (new Date(a_date) < new Date(first_date)) {
          data.progress[first_date] += s.get('PlanEstimate');
        }
      }
    });

    var d = new Date(that.start_date);
    while (true) {
      var prev_d = d.toDateString();
      d.setDate(d.getDate() + 1);

      if (data.progress.hasOwnProperty(d.toDateString())) {
        data.progress[d.toDateString()] += data.progress[prev_d];
      } else {
        break;
      }
    }

    that.build_table(data);
    that.add({ xtype: 'component', html: '<hr />' });
    that.build_feature_graph(data);

    this._mask.hide();
    this.locked = false;
  },

  build_table: function(data) {
    var that = this;

    var table = '<div class="center title">Feature Work Progress Table</div>' +
      '<table class="center"><thead><tr>' +
      '<th class="bold tablecell">Iteration</th>' +
      '<th class="bold tablecell">Percent Feature Work Done</th>' +
      '<th class="bold tablecell">Percent Time</th>' +
      '<th class="bold tablecell">Cumulative Percent Feature Work Done</th>' +
      '<th class="bold tablecell">Cumulative Percent Time</th>' +
      '</tr></thead>';

    var pts = 0;
    var its = 0;
    Object.keys(data.accepted).forEach(function(it) {
      pts += data.accepted[it].amt;
      its += 1;

      table += '<tr>';
      table += '<td class="tablecell">' + it + '</td>';
      table += '<td class="tablecell">' + (data.accepted[it].amt / data.total_planned * 100).toFixed(2) + '%</td>';
      table += '<td class="tablecell">' + (1 / Object.keys(data.accepted).length * 100).toFixed(2) + '%</td>';
      table += '<td class="tablecell">' + (pts / data.total_planned * 100).toFixed(2) + '%</td>';
      table += '<td class="tablecell">' + (its / Object.keys(data.accepted).length * 100).toFixed(2) + '%</td>';
      table += '</tr>';
    });

    table += '</table>';

    this.add({
      xtype: 'component',
      html: table
    });
  },

  build_feature_graph: function(data) {
    var that = this;

    var accepted = [];
    var categories = [];
    var capacity = [];
    var today_index = -1;
    var curr_capacity = 0;
    var iteration_index = 0;
    for (var d = new Date(that.start_date); d <= new Date(that.end_date); d.setDate(d.getDate() + 1)) {
      var dtds = d.toDateString();
      categories.push(dtds);

      if (today_index < 0) {
        accepted.push(data.progress[dtds]);
      }

      if (
        iteration_index < data.capacities.length &&
        data.capacities[iteration_index].d == dtds
      ) {
        curr_capacity += data.capacities[iteration_index].c;
        iteration_index += 1;
      }
      capacity.push(curr_capacity);

      if (dtds == new Date().toDateString()) {
        today_index = categories.length - 1;
      }
    }

    var series = [
      {
        name: 'Capacity',
        data: capacity
      },
      {
        name: 'Accepted',
        data: accepted
      }
    ];

    var feature_chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: { series: series, categories: categories },
      chartConfig: {
        chart: { type: 'area' },
        title: { text: 'Work Accepted vs. Capacity' },
        subtitle: { text: 'This includes all work completed, not just planned feature work' },
        xAxis: { 
          title: { enabled: false },
          tickInterval: 7,
          labels: { rotation: -20 },
          plotLines: [{
            color: 'black',
            value: today_index,
            width: 2,
            label: { text: 'Today' }
          }]
        },
        yAxis: { 
          title: { text: 'Total points' },
          min: 0
        },
        plotOptions: { area: {
          marker: { enabled: false }
        } }
      }
    });
  },

  select_iterations: function(object, new_value, old_value, excluded_its) {
    if (!new_value) {
      excluded_its.push(object);
    } else if (excluded_its.includes(object)) {
      excluded_its.splice(excluded_its.indexOf(object), 1);
    }

    this.fetch_iterations(this.ts, excluded_its);
  }
});

