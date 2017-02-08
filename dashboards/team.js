Ext.define('ZzacksTeamDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  data_keys: [
    'FormattedID',
    '_type',
    'Name',
    'PlanEstimate',
    'Resolution',
    'Tags',
    'RevisionHistory',
    'Revisions',
    'KanbanRevisions',
    'CreationDate',
    'InProgressDate',
    'AcceptedDate',
    'Feature'
  ],
  cycle_time_start_state: 'Started',
  cycle_time_end_state: 'Released',
  columns_big: {
    'FormattedID':      { key: 'FormattedID',    center: true },
    'Type':             { key: '_type',          center: true },
    'Name':             { key: 'Name',           center: false },
    'Estimate':         { key: 'PlanEstimate',   center: true },
    'Created':          { key: 'CreatedDate',    center: true, date: true },
    'Defined':          { key: 'DefinedDate',    center: true, date: true },
    'Started':          { key: 'StartedDate',    center: true, date: true },
    'Completed':        { key: 'CompletedDate',  center: true, date: true },
    'Accepted':         { key: 'AcceptedDate',   center: true, date: true },
    'Released':         { key: 'ReleasedDate',   center: true, date: true },
    'Backtracks':       { key: 'BackCount',      center: true },
    'Skipped':          { key: 'Skipped',        center: true },
    'Cycle Time':       { key: 'CycleTime',      center: true },
    'Resolution':       { key: 'Resolution',     center: false }
  },
  columns_stats: {
    'Type':                 { key: 'name' },
    'Accepted Throughput':  { key: 'throughput_a',  label: true },
    'Released Throughput':  { key: 'throughput_r',  label: true, highlight: true },
    'Cycle Time Avg.':      { key: 'cycle_time',    time: true, highlight: true },
    'Cycle Time Median':    { key: 'median_ct',     time: true, highlight: true },
    'Weekly Released Avg.': { key: 'weekly_r',      label: true },
    'Skipped':              { key: 'skipped',       label: true }
  },
  months: [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ],
  complete_dates: true,
  cycle_time_threshold: 25,

  getUserSettingsFields: function() {
    return [
      {
        name: 'Cycle Time Start State',
        xtype: 'rallycombobox',
        editable: false,
        store: ['Created', 'Defined', 'Started', 'Completed', 'Accepted', 'Released']
      },
      {
        name: 'Cycle Time End State',
        xtype: 'rallycombobox',
        editable: false,
        store: ['Created', 'Defined', 'Started', 'Completed', 'Accepted', 'Released']
      }
    ];
  },

  onSettingsUpdate: function(settings) {
    var that = this;
    this.start(function() {
      if (
        settings['Cycle Time Start State'] != that.cycle_time_start_state
        || settings['Cycle Time End State'] != that.cycle_time_end_state
      ) {
        that.cycle_time_start_state = settings['Cycle Time Start State'];
        that.cycle_time_end_state = settings['Cycle Time End State'];
        that._mask.show();
        that.ts = that.getContext().getTimeboxScope();
        that.fetch_iterations(that.ts);
      }
    });
  },

  launch: function() {
    var that = this;
    this.start(function() {
      if (that.getSettings()['Cycle Time Start State']) {
        that.cycle_time_start_state = that.getSettings()['Cycle Time Start State'];
      } else {
        that.getSettings()['Cycle Time Start State'] = that.cycle_time_start_state;
      }
      if (that.getSettings()['Cycle Time End State']) {
        that.cycle_time_end_state = that.getSettings()['Cycle Time End State'];
      } else {
        that.getSettings()['Cycle Time End State'] = that.cycle_time_end_state;
      }

      that._mask = new Ext.LoadMask(Ext.getBody(), {
        msg: 'Please wait...'
      });
      that._mask.show();
      that.ts = that.getContext().getTimeboxScope();
      that.fetch_iterations(that.ts);
    });
  },

  onTimeboxScopeChange: function(ts) {
    var that = this;
    this.start(function() {
      that._mask.show();
      that.ts = ts;
      that.fetch_iterations(ts);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_iterations(that.ts);
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

  // Fetch a list of the names of the iterations in this quarter.
  fetch_iterations: function(ts) {
    this._mask.msg = 'Fetching iterations...';
    this._mask.show();

    this.start_date = ts.record.raw.ReleaseStartDate;
    this.end_date = ts.record.raw.ReleaseDate;

    var store = Ext.create('Rally.data.wsapi.Store', {
      model: 'Iteration',
      fetch: ['Name', 'StartDate'],
      filters: [
        {
          property: 'StartDate',
          operator: '>=',
          value: this.start_date
        },
        {
          property: 'StartDate',
          operator: '<',
          value: this.end_date
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
          this.num_iterations = records.filter(function(r) {
            return r.get('StartDate').getTime() < Date.now();
          }).length;

          var iterations = [];
          records.forEach(function(r) {
            if (!iterations.includes(r.get('Name'))) {
              iterations.push(r.get('Name'));
            }
          });

          if (iterations.length > 0) {
            this.fetch_stories(iterations, []);
          } else {
            this.haltEarly('No iterations found.');
          }
        }
      }
    });
  },

  // Recursively fetch stories for each iteration filter and add them
  // all together.
  fetch_stories: function(iterations, stories) {
    this._mask.msg = 'Fetching stories...';
    this._mask.show();

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      fetch: this.data_keys,
      filters: [
        {
          property: 'Iteration.Name',
          value: iterations[0]
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
        iterations.shift();

        if (iterations.length > 0) {
          this.fetch_stories(iterations, stories);
        } else {
          if (stories.length > 0) {
            this.fetch_kanban_states(stories);
          } else {
            this.haltEarly('No stories found.');
          }
        }
      }
    });
  },

  // Fetch the allowed kanban states so the order is known.
  fetch_kanban_states: function(stories) {
    this._mask.msg = 'Fetching kanban states...';
    this._mask.show();

    var that = this;

    this.kanban_states = [];
    this.kanban_votes = {};
    Rally.data.ModelFactory.getModel({
    type: 'UserStory',
    success: function(model) {
      model.getField('c_KanbanState').getAllowedValueStore().load({
        callback: function(records, operation, success) {
          if (success) {
            records.forEach(function(r) {
              that.kanban_states[r.get('ValueIndex')] = r.get('StringValue');
              that.kanban_votes[r.get('StringValue')] = false;
            });
          } else {
            console.log(':(');
          }

          that.fetch_histories(stories);
        }
      });
    }
    });
  }, 

  // Fetch the revisions for all the stories.
  fetch_histories: function(stories) {
    this._mask.msg = 'Fetching story histories...';
    this._mask.show();

    var hashed_stories = {};
    stories.forEach(function(s) {
      s.data.Revisions = [];
      s.data.KanbanRevisions = [];
      hashed_stories[s.get('ObjectID')] = s;
    });

    var that = this;
    var t1 = new Date();
    var store = Ext.create('Rally.data.lookback.SnapshotStore', {
      fetch: ['ScheduleState', '_PreviousValues.ScheduleState', '_ValidFrom', 'c_KanbanState', '_PreviousValues.c_KanbanState'],
      hydrate: ['ScheduleState', '_PreviousValues.ScheduleState'],
      filters: [
        {
          property: 'ObjectID',
          operator: 'in',
          value: stories.map(function(s) {
            return s.get('ObjectID');
          })
        }
      ],
      listeners: {
        load: function(store, data, success) {
          var t2 = new Date();
          console.log('Story histories query took', (t2 - t1), 'ms, and retrieved', data ? data.length : 0, 'results.');
          if (success) {
            data.forEach(function(d) {
              if (
                (
                  d.get('_PreviousValues.ScheduleState')
                  && d.get('_PreviousValues.ScheduleState').length > 0
                )
                || d.get('_PreviousValues.ScheduleState') === null
              ) {
                hashed_stories[d.get('ObjectID')].data.Revisions.push({
                  from: d.get('_PreviousValues.ScheduleState'),
                  to: d.get('ScheduleState'),
                  on: d.get('_ValidFrom')
                });
              }

              if (
                (
                  d.get('_PreviousValues.c_KanbanState')
                  && d.get('_PreviousValues.c_KanbanState').length > 0
                )
                || d.get('_PreviousValues.c_KanbanState') === null
              ) {
                hashed_stories[d.get('ObjectID')].data.KanbanRevisions.push({
                  from: d.get('_PreviousValues.c_KanbanState'),
                  to: d.get('c_KanbanState'),
                  on: d.get('_ValidFrom')
                });
                that.kanban_votes[d.get('_PreviousValues.c_KanbanState')] = true;
                that.kanban_votes[d.get('c_KanbanState')] = true;
              }
            });
          }

          that.kanban_states = that.kanban_states.filter(function(k) {
            return that.kanban_votes[k];
          });

          that.get_story_data(stories, []);
        }
      }
    });
    t1 = new Date();
    store.load({ scope: this });
  },

  // Given a millisecond count, format it as 'X days, Y hours'.
  format_ms: function(ms, method = null) {
    var hours = Math.round(ms / 1000 / 60 / 60);
    var days = Math.floor(hours / 24);
    hours -= (days * 24);

    if (method == 'ceil') {
      days += (hours > 0) ? 1 : 0;
    } else if (method == 'round') {
      days += (hours >= 12) ? 1 : 0;
    }

    var out = '';

    if (days > 0) {
      out += days;
      if (days == 1) {
        out += ' day';
      } else {
        out += ' days';
      }

      if (!method) {
        out += ', ';
      }
    }

    if (!method) {
      out += hours;
      if (hours == 1) {
        out += ' hour';
      } else {
        out += ' hours';
      }
    }

    return out;
  },

  // Recursively reformat the data for each story. Once they're all
  // reformatted, pass the data along to the table building function.
  get_story_data: function(raw_stories, stories) {
    this._mask.msg = 'Calculating story statistics...';
    this._mask.show();

    var raw_story = raw_stories[0];
    var story = {};
    this.data_keys.forEach(function(k) {
      story[k] = raw_story.get(k);
    });

    // Make the tags readable.
    story.Tags = story.Tags._tagsNameArray.map(function(o) {
      return o.Name;
    });

    // Make the type more readable and color the row based on the type.
    if (story._type == 'hierarchicalrequirement') {
      story._type = 'S';
      story.color = '#ffffff';
    } else if (story._type == 'defect') {
      if (story.Tags.indexOf('Customer Voice') == -1) {
        story._type = 'D';
        story.color = '#ffa500';
      } else {
        story._type = 'C';
        story.color = '#ff83fa';
      }
    }

    // Calculate the transition dates.
    var dates = [story.CreationDate, null, story.InProgressDate, null, story.AcceptedDate, null];
    var indices = ['This is junk data so that the CreationDate is not overwritten', 'Defined', 'In-Progress', 'Completed', 'Accepted', 'Released'];
    var back_count = 0;
    var back_flag = false;
    story.Revisions.forEach(function(r) {
      var i = indices.indexOf(r.to);
      if (i >= 0) {
        dates[i] = new Date(r.on);
        for (var j = i + 1; j < indices.length; j += 1) {
          if (!back_flag && dates[j]) {
            back_count += 1;
            back_flag = true;
          }
          dates[j] = null;
        }
        back_flag = false;
      }
    });

    // Fill in missing dates.
    var filled = [false, false, false, false, false, false];
    if (this.complete_dates) {
      // Complete the last three dates by copying
      // from the right.
      for (var i = 4; i >= 3; i -= 1) {
        if (!dates[i]) {
          dates[i] = dates[i + 1];
          filled[i] = true;
        }
      }

      // Complete the Defined date by copying the Created
      // date.
      if (!dates[1]) {
        dates[1] = dates[0];
        filled[1] = true;
      }

      // Complete the Started date if it can be
      // reasonably assumed.
      if (
        !dates[2] && dates[1] && dates[3]
        && dates[1].toDateString() == dates[3].toDateString()
      ) {
        dates[2] = dates[1];
        filled[2] = true;
      }
    }

    // Assign the transition dates to the story.
    var names = ['Created', 'Defined', 'Started', 'Completed', 'Accepted', 'Released'];
    for (var i = 0; i < 6; i += 1) {
      story[names[i] + 'Date'] = dates[i];
      story[names[i] + 'DateFilled'] = filled[i];
    }
    story.BackCount = back_count;

    // Check if this story skipped.
    var stage = 0;
    for (var i = 0; i < dates.length; i += 1) {
      if (stage == 0 && !dates[i]) {
        stage = 1;
      } else if (stage == 1 && dates[i]) {
        stage = 2;
      }
    }
    if (stage == 2) {
      story.Skipped = 'Y';
    }

    // Calculate cycle time.
    var cst = story[this.cycle_time_start_state + 'Date'];
    var cet = story[this.cycle_time_end_state + 'Date'];
    if (cst && cet) {
      story.CycleTimeMs = cet - cst;
      for (var d = new Date(cst); d <= cet; d.setDate(d.getDate() + 1)) {
        if (d.getDay() == 0 || d.getDay() == 6) {
          story.CycleTimeMs -= 24 * 60 * 60 * 1000;
        }
      }

      story.CycleTime = this.format_ms(story.CycleTimeMs, 'ceil');
    }

    // Process the next story.
    stories.push(story);
    raw_stories.shift();
    if (raw_stories.length > 0) {
      this.get_story_data(raw_stories, stories);
    } else {
      this.calculate_statistics(stories);
    }
  },

  // Calculate the overall statistics for the entire table.
  calculate_statistics: function(stories) {
    this._mask.msg = 'Calculating overall statistics...';
    this._mask.show();
    var that = this;
    total_stats = {
      C: { name: 'CV Defects', skipped: 0 },
      D: { name: 'Defects', skipped: 0 },
      S: { name: 'Stories', skipped: 0 }
    };

    // Filter out artifacts that lack a StartedDate.
    var filt_stories = stories.filter(function(s) {
      if (s.Skipped) {
        total_stats[s._type].skipped += 1;
        return false;
      } else {
        return true;
      }
    });

    // Throughput.
    Object.keys(total_stats).forEach(function(t) {
      total_stats[t].throughput_r = 0;
      total_stats[t].throughput_a = 0;
      filt_stories.forEach(function(s) {
        if (s._type == t) {
          if (s.ReleasedDate) {
            total_stats[t].throughput_r += 1;
            total_stats[t].throughput_a += 1;
          } else if (s.AcceptedDate) {
            total_stats[t].throughput_a += 1;
          }
        }
      });
    });

    // Weekly released.
    var weekdays = 0;
    var now = new Date();
    if (new Date(this.end_date) < now) {
      now = new Date(this.end_date);
    }
    for (var d = new Date(this.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      if (d.getDay() != 0 && d.getDay() != 6) {
        weekdays += 1;
      }
    }
    Object.keys(total_stats).forEach(function(t) {
      total_stats[t].weekly_r = total_stats[t].throughput_r / (weekdays / 5.0);
    });

    // Average and median cycle time.
    Object.keys(total_stats).forEach(function(t) {
      total_stats[t].cycle_times = [];
      total_stats[t].cycle_count = 0;
    });
    var cst = this.cycle_time_start_state + 'Date';
    var cet = this.cycle_time_end_state + 'Date';
    filt_stories.forEach(function(s) {
      if (s[cst] && s[cet]) {
        var this_cycle_time = s[cet] - s[cst];
        for (var d = new Date(s[cst]); d <= s[cet]; d.setDate(d.getDate() + 1)) {
          if (d.getDay() == 0 || d.getDay() == 6) {
            this_cycle_time -= 1000 * 60 * 60 * 24;
          }
        }
        total_stats[s._type].cycle_times.push(this_cycle_time);
        total_stats[s._type].cycle_count += 1;
      }
    });
    Object.keys(total_stats).forEach(function(t) {
      if (total_stats[t].cycle_count > 0) {
        total_stats[t].cycle_times.sort(function(a, b) {
          return a - b;
        });
        var cts = total_stats[t].cycle_times;

        total_stats[t].cycle_time = 
          cts.reduce(function(a, b) {
            return a + b;
          }, 0) / 
          total_stats[t].cycle_count;

        if (cts.length % 2 == 0 ) {
          total_stats[t].median_ct = (cts[cts.length / 2 - 1] + cts[cts.length / 2]) / 2;
        } else {
          total_stats[t].median_ct = cts[Math.floor(cts.length / 2)];
        }
      }
    });

    this.removeAll();
    this.add_settings_link();
    this.build_stats_table(total_stats);
    this.build_table(stories);
    this.create_options(stories);
    this.build_plot(stories);
    this.build_flow_dia(stories);
    this.build_kanban_dia(stories);
    this._mask.hide();
    this.locked = false;
  },

  // Return a label for a particular data point.
  label_datum: function(datum, type) {
    if (datum == 1) {
      if (type == 'S') {
        return '' + datum + ' story';
      } else {
        return '' + datum + ' defect';
      }
    } else {
      if (type == 'S') {
        return '' + datum + ' stories';
      } else {
        return '' + datum + ' defects';
      }
    }
  },

  create_options: function(stories) {
    var that = this;
    this.add({
      xtype: 'rallycombobox',
      itemId: 'bubble_select',
      fieldLabel: 'Color bubbles by:',
      store: ['Artifact type', 'Feature'],
      listeners: { change: {
        fn: that.change_bubble_type.bind(that)
      }}
    });

    this.stories = stories;
  },

  // Construct the HTML table to display the calculated
  // flow data.
  build_stats_table: function(total_stats) {
    var that = this;

    // The table-wide statistics.
    var stats = '<br /><div class="center title">Throughput Table</div>';
    stats += '<table class="center"><thead><tr>';
    Object.keys(that.columns_stats).forEach(function(k) {
      stats += '<th class="bold tablecell">';
      stats += k;
      stats += '</th>';
    });
    stats += '</tr></thead>';
    Object.keys(total_stats).forEach(function(t) {
      var ts = total_stats[t];
      stats += '<tr>';

      Object.keys(that.columns_stats).forEach(function(k) {
        var d = ts[that.columns_stats[k].key];
        stats += '<td class="tablecell center' +
          (that.columns_stats[k].highlight ?
            ' highlight"' :
            '"') +
          '>';
        if (that.columns_stats[k].label) {
          stats += that.label_datum(d.toLocaleString(), t);
        } else if (that.columns_stats[k].time) {
          stats += that.format_ms(d, 'ceil');
        } else {
          stats += d;
        }
        stats += '</td>';
      });

      stats += '</tr>';
    });
    stats += '</table>';

    this.add({
      xtype: 'component',
      html: stats
    });
  },

  // Construct the HTML table to display the story data.
  build_table: function(stories) {
    var that = this;

    // The toggle button.
    var button = '<br /><a id="toggle_link" href="javascript:;" onclick="toggle_big_table()">Show all stories</a><br />';

    // The table.
    var table = '<table style="display: none" id="big_table"><thead><tr><th class="tablecell">' +
      Object.keys(this.columns_big).join('</th><th class="tablecell">') +
      '</th></tr></thead>';
    stories.forEach(function(story) {
      table += that.build_table_row(story);
    });
    table += '</table><hr />';

    this.add({
      xtype: 'component',
      html: button + table
    });
  },

  // Given a story object, build an HTML row showing the relevant data.
  build_table_row: function(story) {
    var data = story;
    var row = '<tr>';
    var that = this;

    Object.keys(this.columns_big).forEach(function(col) {
      var datum = data[that.columns_big[col].key];
      var center = that.columns_big[col].center;
      var filled = false;
      if (!datum) {
        datum = '';
      } else if (that.columns_big[col].date) {
        filled = data[that.columns_big[col].key + 'Filled'];
        datum = datum.toDateString();
      }

      row += ('<td class="tablecell ' +
        (center ? 'center ' : '') +
        (filled ? 'filled ' : '') +
        '" ' +
        ('bgcolor="' + data.color + '" ') +
        '>' +
        datum +
        '</td>'
      );
    });

    return row;
  },

  // Make a scatter plot.
  build_plot: function(stories, mode = 'Artifact type') {
    var that = this;
    var by_artifact = (mode == 'Artifact type');

    var data, indices;
    if (by_artifact) {
      data = {
        series: [
          {
            name: 'Stories',
            data: []
          },
          {
            name: 'Defects',
            data: []
          },
          {
            name: 'CV Defects',
            data: []
          }
        ]
      };
      var indices = ['S', 'D', 'C'];
    } else {
      indices = ['No feature'];
      stories.forEach(function(s) {
        if (s.Feature && !indices.includes(s.Feature.Name)) {
          indices.push(s.Feature.Name);
        } else if (!s.Feature) {
          s.Feature = { Name: 'No feature' };
        }
      });
      data = { series: [] };
      indices.forEach(function(i) {
        data.series.push({
          name: i,
          data: []
        });
      });
    }
    stories.forEach(function(s) {
      var index = by_artifact ? s._type : s.Feature.Name;
      data.series[indices.indexOf(index)].data.push(s);
    });
    var omitted = 0;
    data.series.forEach(function(c) {
      c.data = c.data.map(function(s) {
        var cet = s[that.cycle_time_end_state + 'Date'];
        if (s.CycleTimeMs && cet) {
          var d = s.CycleTimeMs / 1000 / 60 / 60 / 24;
          var n = s.Name;
          if (n.length > 40) {
            n = n.substring(0, 37) + '...';
          }
          return { 
            x: cet, 
            y: d, 
            z: s.PlanEstimate || 0,
            name: n, 
            fid: s.FormattedID,
            year: cet.getFullYear(),
            month: that.months[cet.getMonth()],
            day: cet.getDate()
          };
        } else {
          return null;
        }
      }).filter(function(p) { 
        if (p && p.y >= that.cycle_time_threshold) {
          omitted += 1;
        }
        return p && p.y < that.cycle_time_threshold;
      });
    });

    this.bubble_chart = this.insert(5, {
      xtype: 'rallychart',
      loadMask: false,
      chartData: data,
      chartConfig: {
        chart: {
          type: 'bubble',
          zoomType: 'xy'
        },
        title: { text: 'Cycle Time This Quarter' },
        subtitle: { text: '<em>' + omitted + ' artifact' + (omitted == 1 ? '' : 's') + ' with cycle times longer than ' + this.cycle_time_threshold + ' days have been omitted.</em>' },
        xAxis: { 
          title: { text: this.cycle_time_end_state + ' date' },
          labels: { 
            formatter: function() {
              return new Date(this.value).toDateString();
            },
          }
        },
        yAxis: { 
          title: { text: 'Cycle time (days)' },
          min: 0
        },
        tooltip: {
          pointFormat: 
            '<b>{point.fid}</b>: {point.name}<br />' +
            this.cycle_time_end_state + ' on {point.day} {point.month} {point.year}<br />' +
            'Cycle time: {point.y:.2f} days<br />' +
            'Estimated at {point.z} points'
        },
        plotOptions: {
          bubble: {
            sizeBy: 'width'
          }
        }
      }
    });
  },

  // Build a cumulative flow diagram.
  build_flow_dia: function(stories) {
    var that = this;
    var labels = [
      // 'CreatedDate',
      // 'DefinedDate',
      'StartedDate',
      'CompletedDate',
      'AcceptedDate',
      'ReleasedDate'
    ];

    var totals = {};
    var start = {};
    var now = new Date();
    if (new Date(this.end_date) < now) {
      now = new Date(this.end_date);
    }
    for (var d = new Date(this.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      totals[d.toDateString()] = {};
    }
    labels.forEach(function(dt) {
      Object.keys(totals).forEach(function(date) {
        totals[date][dt] = 0;
      });
      start[dt] = 0;
    });

    stories.forEach(function(s) {
      prev_state = null;

      labels.forEach(function(dt) {
        if (s[dt]) {
          if (totals.hasOwnProperty(s[dt].toDateString())) {
            totals[s[dt].toDateString()][dt] += 1;
            if (prev_state) {
              totals[s[dt].toDateString()][prev_state] -= 1;
            }
          } else if (s[dt] < new Date(that.start_date)) {
            start[dt] += 1;
            if (prev_state) {
              start[prev_state] -= 1;
            }
          }

          prev_state = dt;
        }
      });
    });

    var prev = start;
    var categories = [];
    var mapped_series = {};
    labels.forEach(function(dt) {
      mapped_series[dt] = [];
    });
    for (var d = new Date(this.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      var df = d.toDateString();
      categories.push(df);
      labels.forEach(function(dt) {
        totals[df][dt] += prev[dt];
        mapped_series[dt].push(totals[df][dt]);
      });
      prev = totals[df];
    }

    var series = [];
    labels.forEach(function(dt) {
      series.push({
        name: dt.slice(0, -4),
        data: mapped_series[dt]
      });
    });

    var chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: { series: series, categories: categories },
      chartConfig: {
        chart: {
          type: 'area'
        },
        title: { text: 'Release Cumulative Flow' },
        xAxis: { 
          title: { enabled: false },
          tickInterval: 7
        },
        yAxis: { title: { text: 'Total points' } },
        plotOptions: {
          area: {
            stacking: 'normal',
            lineColor: '#666666',
            lineWidth: 1,
            tooltip: { split: true, valueSuffix: ' stories' },
            marker: { enabled: false }
          }
        }
      }
    });
  },

  build_kanban_dia: function(stories) {
    var that = this;

    var totals = {};
    var start = {};
    var now = new Date();
    if (new Date(this.end_date) < now) {
      now = new Date(this.end_date);
    }
    for (var d = new Date(this.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      totals[d.toDateString()] = {};
    }
    this.kanban_states.forEach(function(dt) {
      Object.keys(totals).forEach(function(date) {
        totals[date][dt] = 0;
      });
      start[dt] = 0;
    });

    stories.forEach(function(s) {
      s.KanbanRevisions.forEach(function(t) {
        var date = new Date(t.on);
        if (totals[date.toDateString()]) {
          totals[date.toDateString()][t.to] += 1;
          if (t.from) {
            totals[date.toDateString()][t.from] -= 1;
          }
        } else if (date < new Date(that.start_date)) {
          start[t.to] += 1;
          if (t.from) {
            start[t.from] -= 1;
          }
        }
      });
    });

    var prev = start;
    var categories = [];
    var mapped_series = {};
    this.kanban_states.forEach(function(dt) {
      mapped_series[dt] = [];
    });
    for (var d = new Date(this.start_date); d <= now; d.setDate(d.getDate() + 1)) {
      var df = d.toDateString();
      categories.push(df);
      that.kanban_states.forEach(function(dt) {
        totals[df][dt] += prev[dt];
        mapped_series[dt].push(totals[df][dt]);
      });
      prev = totals[df];
    }

    var series = [];
    this.kanban_states.forEach(function(dt) {
      series.push({
        name: dt,
        data: mapped_series[dt]
      });
    });

    var chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: { series: series, categories: categories },
      chartConfig: {
        chart: {
          type: 'area'
        },
        title: { text: 'Kanban Cumulative Flow' },
        xAxis: { 
          title: { enabled: false },
          tickInterval: 7
        },
        yAxis: { title: { text: 'Total points' } },
        plotOptions: {
          area: {
            stacking: 'normal',
            lineColor: '#666666',
            lineWidth: 1,
            tooltip: { split: true, valueSuffix: ' stories' },
            marker: { enabled: false }
          }
        }
      }
    });
  },

  change_bubble_type: function(t, new_item, old_item, e) {
    if (old_item && this.bubble_chart) {
      this.remove(this.bubble_chart);
      this.build_plot(this.stories, new_item);
    }
  },

  // Add a link that opens the app settings.
  add_settings_link: function() {
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_team()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: '<a href="javascript:;" onClick="' +
            'Rally.getApp().showSettings()' +
            '">Modify app settings</a><br />'
    });
  }
});
