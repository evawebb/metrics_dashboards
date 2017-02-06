Ext.define('ZzacksInitiativeDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  drops: {},
  histories_cluster_size: 300,

  getUserSettingsFields: function() {
    return [{
      xtype: 'component',
      html: 'Type the name or code of the initiative below, then select it from the dropdown.'
    }, {
      name: 'Initiative',
      xtype: 'rallyartifactsearchcombobox',
      storeConfig: {
        models: ['PortfolioItem/Initiative']
      }
    }];
  },

  onSettingsUpdate: function(settings) {
    this.fetch_initiative(this.ts);
  },

  launch: function() {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    if (!this.getSettings().Initiative) {
      this.getSettings().Initiative = '/portfolioitem/initiative/44772028590';
    }
    this.ts = this.getContext().getTimeboxScope();
    this.fetch_initiative(this.ts);
  },

  onTimeboxScopeChange: function(ts) {
    this._mask = new Ext.LoadMask(Ext.getBody(), {
      msg: 'Please wait...'
    });
    this._mask.show();

    this.ts = ts;
    this.fetch_initiative(ts);
  },

  refresh: function() {
    this.fetch_initiative(this.ts);
  },

  haltEarly: function(msg) {
    this._mask.hide();
    this.removeAll();
    this.add_settings_link();
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
    });
  },

  fetch_initiative: function(ts) {
    this._mask.msg = 'Fetching initiative...';
    this._mask.show();

    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Initiative'],
      filters: {
        property: 'ObjectID',
        value: parseInt(that.getSettings().Initiative.split('/').reverse()[0])
      }
    }, this);
    store.load({
      scope: this,
      callback: function(records, operation) {
        if (operation.wasSuccessful() && records[0]) {
          that.fetch_committed_features(records[0].data, ts);
        } else {
          that.haltEarly('Problem loading initiative.');
        }
      }
    });
  },

  fetch_committed_features: function(initiative, ts) {
    this._mask.msg = 'Fetching features...';
    this._mask.show();

    var that = this;
    
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
          value: initiative.FormattedID
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
            that.fetch_unscheduled_features(records, initiative, ts);
          } else {
            that.haltEarly('No features found.');
          }
        }
      }
    });
  },

  fetch_unscheduled_features: function(features, initiative, ts) {
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
          value: initiative.FormattedID
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
          this.fetch_unschedule_dates(features, records, initiative, ts);
        } else {
          this.fetch_stories(features, [], initiative, ts);
        }
      }
    });
  },

  fetch_unschedule_dates(features, unsched_features, initiative, ts) {
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
      ],
      limit: 1000
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
            return r.get('Description').match(new RegExp(
              'RELEASE (removed|changed from) \\['
              + ts.record.raw.Name
              + '\\]'
            ));
          });
          
          if (r_filt.length > 0) {
            relevant = true;
            r_filt.forEach(function(r) {
              that.drops[unsched_features[0].get('ObjectID')] = 
                r.get('CreationDate').toDateString();
            });
          }
        }

        if (relevant) {
          features.push(unsched_features.shift());
        } else {
          unsched_features.shift();
        }

        if (unsched_features.length > 0) {
          this.fetch_unschedule_dates(features, unsched_features, initiative, ts);
        } else {
          this.fetch_stories(features, [], initiative, ts);
        }
      }
    });
  },

  fetch_stories: function(features, stories, initiative, ts) {
    this._mask.msg = 'Fetching stories... (' + features.length + ' features left)';
    this._mask.show();

    var that = this;
    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      fetch: ['ObjectID', 'Name', 'PlanEstimate', 'FormattedID', 'Feature', 'CreationDate'],
      filters: [
        {
          property: 'Feature.Name',
          value: features[0].get('Name')
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
        if (operation.wasSuccessful()) {
          stories = stories.concat(records);
        }
        features.shift();

        if (features.length > 0) {
          this.fetch_stories(features, stories, initiative, ts);
        } else {
          this.fetch_histories(stories, 0, {}, initiative, ts);
        }
      }
    });
  },

  fetch_histories: function(stories, index, release_dates, initiative, ts) {
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
                ts
              );
            } else {
              that.construct_series(
                release_dates, 
                stories,
                initiative,
                ts
              );
            }
          }
        }
      }
    });
    t1 = new Date();
    store.load({ scope: this });
  },

  construct_series: function(release_dates, stories, initiative, ts) {
    var that = this;
    var deltas = {};
    var now = new Date();
    if (new Date(ts.record.raw.ReleaseDate) < now) {
      now = new Date(ts.record.raw.ReleaseDate);
    }
    for (var d = new Date(ts.record.raw.ReleaseStartDate); d <= now; d.setDate(d.getDate() + 1)) {
      deltas[d.toDateString()] = {
        released_pts: 0,
        created_pts: 0,
        released_stories: 0,
        created_stories: 0
      };
    }

    stories.forEach(function(s) {
      var r_date = release_dates[s.get('FormattedID')];
      var c_date = s.get('CreationDate').toDateString();
      var drop = that.drops[s.get('Feature').ObjectID];

      if (r_date && deltas[r_date]) {
        deltas[r_date].released_pts += s.get('PlanEstimate');
        deltas[r_date].released_stories += 1;

        if (drop && deltas[drop]) {
          deltas[drop].released_pts -= s.get('PlanEstimate');
          deltas[drop].released_stories -= 1;
        }
      }

      if (c_date) {
        if (!drop || deltas[drop]) {
          if (deltas[c_date]) {
            deltas[c_date].created_pts += s.get('PlanEstimate');
            deltas[c_date].created_stories += 1;
          } else {
            deltas[Object.keys(deltas)[0]].created_pts += s.get('PlanEstimate');
            deltas[Object.keys(deltas)[0]].created_stories += 1;
          }
        }

        if (drop && deltas[drop]) {
          deltas[drop].created_pts -= s.get('PlanEstimate');
          deltas[drop].created_stories -= 1;
        }
      }
    });
    
    for (var i = 0; i < Object.keys(deltas).length - 1; i += 1) {
      var d_prev = Object.keys(deltas)[i];
      var d_next = Object.keys(deltas)[i + 1];
      deltas[d_next].released_pts += deltas[d_prev].released_pts;
      deltas[d_next].released_stories += deltas[d_prev].released_stories;
      deltas[d_next].created_pts += deltas[d_prev].created_pts;
      deltas[d_next].created_stories += deltas[d_prev].created_stories;
    }
    this.removeAll();
    this.create_options(deltas, initiative);
  },

  create_options: function(deltas, initiative) {
    var that = this;
    this.add_settings_link();
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
          deltas[d].released_pts :
          deltas[d].released_stories,
        date: d,
        x: new Date(d).getTime()
      });
      created_data.push({
        y: points ?
          deltas[d].created_pts :
          deltas[d].created_stories,
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
      }}
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
          title: { text: (points ? 'Points' : 'Stories/defects') + ' released for ' + initiative.FormattedID + ': ' + initiative.Name },
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
  },

  change_graph_type: function(t, new_item, old_item, e) {
    if (old_item && this.chart) {
      this.remove(this.chart);
      this.build_charts(this.deltas, this.initiative, new_item);
    }
  },

  add_settings_link: function() {
    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_initiative()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: '<a href="javascript:;" onClick="' +
            'Rally.getApp().showSettings()' +
            '">Modify app settings</a><br />'
    });
  }
});
