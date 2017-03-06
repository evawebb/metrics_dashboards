Ext.define('ZzacksInitiativeDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  drops: {},
  histories_cluster_size: 300,
  update_interval: 1 * 60 * 60 * 1000,
  // update_interval: 24 * 60 * 60 * 1000,
  cache_tag: 'cached_data_i_',

  getUserSettingsFields: function() {
    return [{
      xtype: 'component',
      html: 'Type the name or code of the initiative below, then select it from the dropdown.'
    }, {
      name: 'Initiative',
      xtype: 'rallytextfield'
    }];
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
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    var that = this;
    this.start(function() {
      that.ts = ts;
      that.clean_cached_data(that.ts);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_initiatives(that.ts);
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
    this.add_settings_link();
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
    });
    this.locked = false;
  },

  clean_cached_data: function(ts) {
    this._mask.msg = 'Checking cached data...';
    this._mask.show();
    var that = this;

    Rally.data.PreferenceManager.load({
      appID: this.getAppId(),
      success: function(prefs) {
        var stale = [];
        Object.keys(prefs).forEach(function(p) {
          if (p.substr(0, 11) == 'cached_data') {
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

  check_initiative: function(init_list) {
    if (init_list.length > 0) {
      var existing_initiative = this.Initiative + ': ' + this.InitiativeName;
      if (!init_list.includes(existing_initiative)) {
        var sp = init_list[0].split(':');
        this.Initiative = sp[0];
        this.InitiativeName = sp[1].slice(1)
      }
    } else {
      this.haltEarly("No initiatives found.");
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
        var key = that.cache_tag + team + '_' + release + '_' + that.Initiative;
        if (prefs[key]) {
          var cd = JSON.parse(prefs[key]);
          var last_update = new Date(cd.date);
          if (new Date() - last_update < that.update_interval) {
            cd.init_list.sort();
            cd.init_list.unshift('No initiative');
            that.create_options_pipeline(cd.deltas, cd.initiative, cd.init_list);
          } else {
            that.fetch_initiatives(ts);
          }
        } else {
          that.fetch_initiatives(ts);
        }
      }
    });
  },

  fetch_initiatives: function(ts) {
    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Initiative'],
      fetch: ['Name', 'FormattedID'],
      limit: 1000
      // This is a quicker way to filter initiatives out of the dropdown.
      // filters: [
      //   {
      //     property: 'LastUpdateDate',
      //     operator: '>',
      //     value: ts.record.raw.ReleaseStartDate
      //   }
      // ]
    }, this);
    store.load({
      scope: this,
      callback: function(records, operation) {
        var init_list = [];
        if (operation.wasSuccessful()) {
          init_list = records;
        }

        that.filter_initiatives(ts, init_list);
      }
    });
  },

  filter_initiatives(ts, init_list) {
    this._mask.msg = 'Filtering initiatives...';
    this._mask.show();
    var that = this;

    f_init_list = [];
    remaining_inits = init_list.length;

    init_list.forEach(function(init) {
      var store = Ext.create('Rally.data.wsapi.artifact.Store', {
        models: ['PortfolioItem/Feature'],
        fetch: ['Name', 'Release'],
        filters: [
          {
            property: 'Release.Name',
            value: ts.record.raw.Name
          },
          {
            property: 'Parent.FormattedID',
            value: init.get('FormattedID')
          }
        ]
      }, this);
      var t1 = new Date();
      store.load({
        scope: this,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Initiative filter query took', (t2 - t1), 'ms.');
    
          that._mask.msg = 'Filtering initiatives... (' + (remaining_inits - 1) + ' initiatives left)';
          that._mask.show();

          if (operation.wasSuccessful() && records.length > 0) {
            f_init_list.push(init.get('FormattedID') + ': ' + init.get('Name'));
          }

          remaining_inits -= 1;
          if (remaining_inits == 0) {
            f_init_list.sort();
            f_init_list.unshift('No initiative');
            if (!that.Initiative) {
              that.end_without_graph(f_init_list);
            } else {
              that.fetch_committed_features(ts, f_init_list);
            }
          }
        }
      });
    });
  },

  fetch_committed_features: function(ts, init_list) {
    this._mask.msg = 'Fetching features...';
    this._mask.show();

    var that = this;

    this.check_initiative(init_list);
    var initiative = this.Initiative;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: ['Name', 'Release'],
      filters: [
        {
          property: 'Release.Name',
          value: ts.record.raw.Name
        },
        {
          property: 'Parent.FormattedID',
          value: initiative
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
          if (records.length > 0) {
            that.fetch_unscheduled_features(records, initiative, ts, init_list);
          } else {
            that.cache_data({}, initiative, init_list);
          }
        }
      }
    });
  },

  fetch_unscheduled_features: function(features, initiative, ts, init_list) {
    this._mask.msg = 'Fetching unscheduled features...';
    this._mask.show();
    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: ['Name', 'Release', 'ObjectID', 'RevisionHistory'],
      filters: [
        {
          property: 'Release.Name',
          operator: '!=',
          value: ts.record.raw.Name
        },
        {
          property: 'Parent.FormattedID',
          value: initiative
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Unscheduled features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (records && records.length > 0) {
          this.fetch_unschedule_dates(features, records, initiative, ts, init_list);
        } else {
          this.fetch_stories(features, initiative, ts, init_list);
        }
      }
    });
  },

  fetch_unschedule_dates(features, unsched_features, initiative, ts, init_list) {
    var remaining_features = unsched_features.length;
    this._mask.msg = 'Calculating unscheduled feature dates... (' + remaining_features + ' features remaining)';
    this._mask.show();
    var that = this;

    unsched_features.forEach(function(uf) {
      var store = Ext.create('Rally.data.wsapi.Store', {
        model: 'Revision',
        fetch: ['Description', 'CreationDate'],
        filters: [
          {
            property: 'RevisionHistory.ObjectID',
            value: uf.get('RevisionHistory')._ref.split(',').reverse()[0]
          }
        ],
        sorters: [
          {
            property: 'RevisionNumber',
            direction: 'ASC'
          }
        ],
        limit: 1000
      }, this);
      var t1 = new Date();
      store.load({
        scope: this,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Unscheduled dates query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

          remaining_features -= 1;
          that._mask.msg = 'Calculating unscheduled feature dates... (' + remaining_features + ' features left)';
          that._mask.show();

          var relevant = false;
          if (operation.wasSuccessful()) {
            var r_filt = records.filter(function(r) {
              return r.get('Description').match(new RegExp(
                'RELEASE (removed|changed from) \\[' +
                ts.record.raw.Name +
                '\\]'
              ));
            });

            if (r_filt.length > 0) {
              relevant = true;
              r_filt.forEach(function(r) {
                that.drops[uf.get('ObjectID')] = r.get('CreationDate').toDateString();
              });
            }
          }

          if (relevant) {
            features.push(uf);
          }

          if (remaining_features == 0) {
            that.fetch_stories(features, initiative, ts, init_list);
          }
        }
      });
    });
  },

  fetch_stories: function(features, initiative, ts, init_list) {
    var remaining_features = features.length;
    this._mask.msg = 'Fetching stories... (' + remaining_features + ' features remaining)';
    this._mask.show();
    var that = this;

    var stories = [];

    features.forEach(function(f) {
      var store = Ext.create('Rally.data.wsapi.artifact.Store', {
        models: ['UserStory', 'Defect'],
        fetch: ['ObjectID', 'Name', 'PlanEstimate', 'FormattedID', 'Feature', 'CreationDate'],
        filters: [
          {
            property: 'Feature.Name',
            value: f.get('Name')
          },
          {
            property: 'DirectChildrenCount',
            value: 0
          }
        ]
      }, this);
      var t1 = new Date();
      store.load({
        scope: this,
        callback: function(records, operation) {
          var t2 = new Date();
          console.log('Stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

          remaining_features -= 1;
          that._mask.msg = 'Fetching stories... (' + remaining_features + ' features left)';
          that._mask.show();

          if (operation.wasSuccessful()) {
            stories = stories.concat(records);
          }

          if (remaining_features == 0) {
            that.fetch_histories(stories, 0, {}, initiative, ts, init_list);
          }
        }
      });
    });
  },

  fetch_histories: function(stories, index, release_dates, initiative, ts, init_list) {
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
      hydrate: [
        'ScheduleState', 
        '_PreviousValues.ScheduleState'
      ],
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
                initiative,
                ts,
                init_list
              );
            } else {
              that.construct_series(
                release_dates, 
                stories,
                initiative,
                ts,
                init_list
              );
            }
          }
        }
      }
    });
    t1 = new Date();
    store.load({ scope: this });
  },

  construct_series: function(release_dates, stories, initiative, ts, init_list) {
    var that = this;
    var deltas = {};
    var now = new Date();
    if (new Date(ts.record.raw.ReleaseDate) < now) {
      now = new Date(ts.record.raw.ReleaseDate);
    }
    for (var d = new Date(ts.record.raw.ReleaseStartDate); d <= now; d.setDate(d.getDate() + 1)) {
      deltas[d.toDateString()] = {
        rp: 0,
        cp: 0,
        rs: 0,
        cs: 0
      };
    }

    stories.forEach(function(s) {
      var first_date = Object.keys(deltas)[0];
      var r_date = release_dates[s.get('FormattedID')];
      var c_date = s.get('CreationDate').toDateString();
      var drop = that.drops[s.get('Feature').ObjectID];

      if (
        !drop ||
        new Date(drop) >= new Date(first_date)
      ) {
        if (
          c_date &&
          (
            !drop ||
            new Date(drop) > new Date(c_date)
          )
        ) {
          if (deltas[c_date]) {
            deltas[c_date].cp += s.get('PlanEstimate');
            deltas[c_date].cs += 1;
          } else if (new Date(c_date) < new Date(first_date)) {
            deltas[first_date].cp += s.get('PlanEstimate');
            deltas[first_date].cs += 1;
          }

          if (drop && deltas[drop] && new Date(drop) >= new Date(c_date)) {
            deltas[drop].cp -= s.get('PlanEstimate');
            deltas[drop].cs -= 1;
          }
        }

        if (
          r_date &&
          (
            !drop ||
            new Date(drop) > new Date(r_date)
          )
        ) {
          if (deltas[r_date]) {
            deltas[r_date].rp += s.get('PlanEstimate');
            deltas[r_date].rs += 1;
          } else if (new Date(r_date) < new Date(first_date)) {
            deltas[first_date].rp += s.get('PlanEstimate');
            deltas[first_date].rs += 1;
          }

          if (drop && deltas[drop] && new Date(drop) >= new Date(r_date)) {
            deltas[drop].rp -= s.get('PlanEstimate');
            deltas[drop].rs -= 1;
          }
        }
      }
    });
    
    for (var i = 0; i < Object.keys(deltas).length - 1; i += 1) {
      var d_prev = Object.keys(deltas)[i];
      var d_next = Object.keys(deltas)[i + 1];
      deltas[d_next].rp += deltas[d_prev].rp;
      deltas[d_next].rs += deltas[d_prev].rs;
      deltas[d_next].cp += deltas[d_prev].cp;
      deltas[d_next].cs += deltas[d_prev].cs;
    }
    this.cache_data(deltas, initiative, init_list);
  },

  cache_data: function(deltas, initiative, init_list) {
    var that = this;
    
    var release = this.ts.record.raw.Name;
    var team = this.getContext().getProject().ObjectID;
    var key = this.cache_tag + team + '_' + release + '_' + that.Initiative;
    this.prefs[key] = JSON.stringify({
      date: new Date(),
      deltas: deltas,
      initiative: initiative,
      init_list: init_list
    });
    Rally.data.PreferenceManager.update({
      appID: this.getAppId(),
      settings: this.prefs,
      success: function(response) {
        if (response[0].errorMessages) {
          console.log('Error saving preferences:', response[0].errorMessages);
        }
        that.create_options_pipeline(deltas, initiative, init_list);
      }
    });
  },

  end_without_graph: function(init_list) {
    this.create_options(init_list)
    this._mask.hide();
    this.locked = false;
  },

  create_options: function(init_list) {
    var that = this;
    this.removeAll();

    this.add_settings_link();
    this.change_init = false;
    this.add({
      xtype: 'rallycombobox',
      itemId: 'initiative_select',
      fieldLabel: 'Initiative',
      store: init_list,
      value: this.Initiative + ': ' + this.InitiativeName,
      listeners: { change: {
        fn: that.change_initiative.bind(that)
      }}
    });
    this.change_init = true;
    this.add({
      xtype: 'rallycombobox',
      itemId: 'graph_select',
      fieldLabel: 'Y-axis:',
      store: ['Total points', 'Total stories/defects'],
      listeners: { change: {
        fn: that.change_graph_type.bind(that)
      }}
    });
  },

  create_options_pipeline: function(deltas, initiative, init_list) {
    this.create_options(init_list);

    this.deltas = deltas;
    this.initiative = initiative;
    this.build_charts(deltas, initiative, 'Total points');
  },

  build_charts: function(deltas, initiative, type) {
    this._mask.msg = 'Building chart...';
    this._mask.show();

    var points = type == 'Total points';

    var that = this;
    var series = [];
    var released_config = {
      name: 'Released',
      color: '#0000ff'
    };
    var created_config = {
      name: 'Planned',
      color: '#0000ff',
      dashStyle: 'Dot'
    };
    var released_data = [];
    var created_data = [];

    Object.keys(deltas).forEach(function(d) {
      released_data.push({
        y: points ?
          deltas[d].rp :
          deltas[d].rs,
        date: d,
        x: new Date(d).getTime()
      });
      created_data.push({
        y: points ?
          deltas[d].cp :
          deltas[d].cs,
        date: d,
        x: new Date(d).getTime()
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

    var chart_config = {
      chart: { type: 'line' },
      xAxis: { 
        title: { text: 'Days into the quarter' },
        max: new Date(this.ts.record.raw.ReleaseDate).getTime(),
        min: new Date(this.ts.record.raw.ReleaseStartDate).getTime(),
        labels: { 
          formatter: function() {
            return new Date(this.value).toDateString();
          },
          rotation: -20
        }
      },
      plotOptions: { line: {
        lineWidth: 3,
        marker: { enabled: false }
      } }
    };
    var tooltip_header = '<span style="font-size: 10px">{series.name}</span><br/>';
    var tooltip_point = '<b>{point.y} {unit}</b><br />on {point.date}';

    this.chart = this.add({
      xtype: 'rallychart',
      loadMask: false,
      chartData: {
        series: series.reverse()
      },
      chartConfig: Object.assign(
        {
          title: { text: (points ? 'Points' : 'Stories/defects') + ' released for ' + initiative + ': ' + this.InitiativeName },
          yAxis: { 
            title: { text: 'Total ' + (points ? 'points' : 'artifacts')},
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

  change_graph_type: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.remove(this.chart);
      this.build_charts(this.deltas, this.initiative, new_item);
    }
  },

  change_initiative: function(t, new_item, old_item, e) {
    if (this.change_init && old_item) {
      if (new_item != 'No initiative') {
        var that = this;
        this.start(function() {
          var sp = new_item.split(':');
          that.Initiative = sp[0];
          that.InitiativeName = sp[1].slice(1)
          that.clean_cached_data(that.ts);
        });
      } else {
        var that = this;
        this.start(function() {
          delete that.Initiative;
          delete that.InitiativeName;
          that.clean_cached_data(that.ts);
        });
      }
    }
  },

  add_settings_link: function() {
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_initiative()">Refresh this dashboard</a><hr />'
    });
  }
});
