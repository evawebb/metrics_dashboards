Ext.define('ZzacksTeamProgressDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  data_groups: {
    planned: 'Planned Work',
    unplanned: 'Unplanned Stories & Defects',
    cvdefect: 'CV Defects'
  },
  colors: [
    '#803e75', '#ffb300', '#ff6800', '#a6bdd7',
    '#c10020', '#cea262', '#817066', '#007d34',
    '#f6768e', '#00538a', '#ff7a5c', '#53377a',
    '#ff8e00', '#b32851', '#f4c800', '#7f180d',
    '#93aa00', '#593315', '#f13a13', '#232c16'
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
      that.first_run = true;
      that.ts = that.getContext().getTimeboxScope();
      that.fetch_iterations(that.ts, [], true);
    });
  },

  onTimeboxScopeChange: function(ts) {
    var that = this;
    this.start(function() {
      that.first_run = true;
      that.ts = ts;
      that.fetch_iterations(ts, [], true);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.first_run = true;
      that.fetch_iterations(that.ts, [], true);
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

  fetch_iterations: function(ts, excluded_its, filter_ip) {
    this._mask.msg = 'Fetching iterations...';
    this._mask.show();
    var that = this;

    that.release = ts.record.raw.Name;
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

        if (filter_ip) {
          records.forEach(function(it) {
            if (it.get('Name').includes('IP')) {
              excluded_its.push(it.get('Name'));
            }
          });
        }

        if (operation.wasSuccessful()) {
          that.fetch_stories(records, excluded_its);
        }
      }
    });
  },

  fetch_stories: function(iterations, excluded_its) {
    var remaining_iterations = iterations.length;
    this._mask.msg = 'Fetching stories... (' + remaining_iterations + ' iterations remaining)';
    this._mask.show();
    var that = this;

    var stories = [];

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      fetch: [
        'ScheduleState', 'PlanEstimate',
        'AcceptedDate', 'Tags', 'Feature'
      ],
      filters: [
        {
          property: 'Release.Name',
          value: that.release
        }
      ],
      limit: 1000
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Artifacts query took', (t2 - t1), 'ms and retrieved', records ? records.length : 0, 'results.');
        if (operation.wasSuccessful()) {
          that.removeAll();
          that.create_options(iterations, records, excluded_its);
        }
      }
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

    Object.keys(that.data_groups).forEach(function(k) {
      data.progress[k] = {};
    });
    data.progress.all = {};

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
      Object.keys(data.progress).forEach(function(k) {
        data.progress[k][d.toDateString()] = 0;
      });
      data.progress.all[d.toDateString()] = 0;
    }

    var first_date = new Date(that.start_date).toDateString();
    stories.forEach(function(s) {
      data.total += s.get('PlanEstimate');

      var progress_key;
      if (s.get('ScheduleState') == 'Released' || s.get('ScheduleState') == 'Accepted') {
        var a_date = s.get('AcceptedDate');
        var a_date_s = a_date.toDateString();

        if (s.get('Feature')) {
          data.total_planned += s.get('PlanEstimate');

          Object.keys(data.accepted).forEach(function(it) {
            var r = data.accepted[it];
            if (r.start <= a_date && a_date < r.end) {
              r.amt += s.get('PlanEstimate');
            }
          });

          progress_key = 'planned';
        } else if (
          s.get('Tags')._tagsNameArray.map(function(t) { return t.Name; })
            .includes('Customer Voice')
        ) {
          progress_key = 'cvdefect';
        } else {
          progress_key = 'unplanned';
        }

        if (data.progress[progress_key].hasOwnProperty(a_date_s)) {
          data.progress[progress_key][a_date_s] += s.get('PlanEstimate');
          data.progress.all[a_date_s] += s.get('PlanEstimate');
        } else if (new Date(a_date_s) < new Date(first_date)) {
          data.progress[progress_key][first_date] += s.get('PlanEstimate');
          data.progress.all[first_date] += s.get('PlanEstimate');
        }
      } else {
        if (s.get('Feature')) {
          data.total_planned += s.get('PlanEstimate');
        }
      }
    });

    var first_key = Object.keys(data.progress)[0];
    var d = new Date(that.start_date);
    while (true) {
      var prev_d = d.toDateString();
      d.setDate(d.getDate() + 1);

      if (data.progress[first_key].hasOwnProperty(d.toDateString())) {
        Object.keys(data.progress).forEach(function(k) {
          data.progress[k][d.toDateString()] += data.progress[k][prev_d];
        });
      } else {
        break;
      }
    }

    that.build_table(data);
    that.add({ xtype: 'component', html: '<hr />' });
    that.build_plan_progress_graph(data);
    that.add({ xtype: 'component', html: '<hr />' });
    that.build_feature_graph(data);

    this._mask.hide();
    this.locked = false;
  },

  build_table: function(data) {
    var that = this;

    var items = [];
    var pts = 0;
    var its = 0;
    Object.keys(data.accepted).forEach(function(it) {
      pts += data.accepted[it].amt;
      its += 1;

      items.push({
        iteration: it,
        percent_done: data.accepted[it].amt / data.total_planned * 100,
        percent_time: 1 / Object.keys(data.accepted).length * 100,
        cumul_done: pts / data.total_planned * 100,
        cumul_time: its / Object.keys(data.accepted).length * 100
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

    var renderer = function(v) {
      return '' + v.toFixed(2) + '%';
    };
    var w = 150;
    that.add({
      xtype: 'gridpanel',
      title: 'Feature Work Progress Table',
      store: store,
      columns: [{
        text: 'Iteration',
        dataIndex: 'iteration',
        width: w
      }, {
        text: 'Percent Feature<br />Work Done',
        dataIndex: 'percent_done',
        width: w,
        renderer: renderer
      }, {
        text: 'Percent Time',
        dataIndex: 'percent_time',
        width: w,
        renderer: renderer
      }, {
        text: 'Cumulative Percent<br />Feature Work Done',
        dataIndex: 'cumul_done',
        width: w,
        renderer: renderer
      }, {
        text: 'Cumulative<br />Percent Time',
        dataIndex: 'cumul_time',
        width: w,
        renderer: renderer
      }],
      width: 5 * w + 2
    });
  },

  build_plan_progress_graph: function(data) {
    var that = this;

    var first_date = new Date();
    var last_date = new Date(0);
    Object.keys(data.accepted).forEach(function(it) {
      if (data.accepted[it].start < first_date) {
        first_date = data.accepted[it].start;
      }
      if (data.accepted[it].end > last_date) {
        last_date = data.accepted[it].end;
      }
    });

    var accepted_plan = [];
    var categories = [];
    var today_index = -1;
    for (var d = first_date; d <= last_date; d.setDate(d.getDate() + 1)) {
      var dtds = d.toDateString();
      categories.push(dtds);

      if (today_index < 0) {
        accepted_plan.push(data.progress.planned[dtds]);
      }

      if (dtds == new Date().toDateString()) {
        today_index = categories.length - 1;
      }
    }

    var goal_line = [
      {
        x: 0,
        y: 0
      }, 
      {
        x: categories.length - 1,
        y: data.total_planned
      }
    ];

    var series = [
      {
        name: 'Goal',
        data: goal_line,
        color: that.colors[0]
      }, 
      {
        name: 'Accepted',
        data: accepted_plan,
        color: that.colors[1]
      }
    ]

    var plan_progress_chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: { series: series, categories: categories },
      chartConfig: {
        chart: { type: 'area' },
        title: { text: 'Planned Work Progress' },
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
          min: 0,
          max: data.total_planned
        },
        plotOptions: { area: {
          marker: { enabled: false }
        } }
      }
    });
  },

  build_feature_graph: function(data) {
    var that = this;

    var accepted = {};
    var categories = [];
    var capacity = [];
    var today_index = -1;
    var curr_capacity = 0;
    var iteration_index = 0;
    Object.keys(that.data_groups).forEach(function(k) {
      accepted[k] = [];
    });

    for (var d = new Date(that.start_date); d <= new Date(that.end_date); d.setDate(d.getDate() + 1)) {
      var dtds = d.toDateString();
      categories.push(dtds);

      if (
        iteration_index < data.capacities.length &&
        data.capacities[iteration_index].d == dtds
      ) {
        curr_capacity += data.capacities[iteration_index].c;
        iteration_index += 1;
      }
      capacity.push(curr_capacity);

      if (today_index < 0) {
        Object.keys(that.data_groups).forEach(function(k) {
          accepted[k].push({
            y: data.progress[k][dtds],
            date: dtds,
            percent_of_capacity: (data.progress[k][dtds] / curr_capacity * 100).toFixed(2),
            percent_of_accepted: (data.progress[k][dtds] / data.progress.all[dtds] * 100).toFixed(2)
          });
        });
      }

      if (dtds == new Date().toDateString()) {
        today_index = categories.length - 1;
      }
    }

    var series = [
      {
        name: 'Capacity',
        data: capacity,
        color: that.colors[0],
        stack: 'none'
      }
    ];

    i = 1;
    Object.keys(that.data_groups).forEach(function(k) {
      series.push({
        name: that.data_groups[k],
        data: accepted[k],
        color: that.colors[i],
        stack: 'accepted'
      });
      i += 1;
    });

    var all_work_chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: { series: series, categories: categories },
      chartConfig: {
        chart: { type: 'area' },
        title: { text: 'All Work Accepted vs. Capacity' },
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
        tooltip: {
          headerFormat: '',
          pointFormat:
            '<b>{series.name}:</b> {point.y} points<br />' +
            '{point.percent_of_accepted}% of accepted points<br />' +
            '{point.percent_of_capacity}% of capacity<br />' +
            '<span style="font-size: 10px">{point.date}</span><br />'
        },
        plotOptions: { area: {
          marker: { enabled: false },
          stacking: 'normal'
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

    this.fetch_iterations(this.ts, excluded_its, false);
  }
});

