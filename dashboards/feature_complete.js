Ext.define('ZzacksFeatureCompleteDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  percent_renderer: function(v) { return '' + (v * 100).toFixed(2) + '%'; },
  columns: [
    { name: 'Rank', key: 'Rank', width: 40 },
    { name: 'Formatted<br />ID', key: 'FormattedID', width: 70 },
    { name: 'Name', key: 'Name', width: 400 },
    { name: 'Completed<br />Points', key: 'AcceptedLeafStoryPlanEstimateTotal', width: 70 },
    { name: 'Total<br />Planned<br />Points', key: 'LeafStoryPlanEstimateTotal', width: 70 },
    { name: 'Percent<br />Done<br />(points)', key: 'PercentDoneByStoryPlanEstimate', renderer: true, width: 70 },
    { name: 'Completed<br />Stories', key: 'AcceptedLeafStoryCount', width: 70 },
    { name: 'Total<br />Planned<br />Stories', key: 'LeafStoryCount', width: 70 },
    { name: 'Percent<br />Done<br />(stories)', key: 'PercentDoneByStoryCount', renderer: true, width: 70 }
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
      that.ts = that.getContext().getTimeboxScope();
      that.fetch_features(that.ts);
    });
  },

  onTimeboxScopeChange: function(ts) {
    var that = this;
    this.start(function() {
      that.ts = ts;
      that.fetch_features(ts);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_features(that.ts);
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

  fetch_features: function(release) {
    var that = this;
    that._mask.msg = 'Fetching features...';
    that._mask.show();

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      fetch: [
        'FormattedID', 'Name', 'Release', 'DragAndDropRank',
        'PercentDoneByStoryCount', 'PercentDonebyStoryPlanEstimate',
        'LeafStoryCount', 'LeafStoryPlanEstimateTotal',
        'AcceptedLeafStoryCount', 'AcceptedLeafStoryPlanEstimateTotal'
      ],
      filters: [{
        property: 'Release.Name',
        value: release.record.raw.Name
      }],
      sorters: [{
        property: 'DragAndDropRank',
        direction: 'ASC'
      }]
    }, that);
    var t1 = new Date();
    store.load({
      scope: that,
      limit: 1000,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');

        if (operation.wasSuccessful()) {
          that.calculate_data(records);
        }
      }
    });
  },

  calculate_data: function(features) {
    var that = this;

    var summary = {
      features_complete_stories: 0,
      features_complete_points: 0,
      total_features: 0,
      percent_complete_stories: 0,
      percent_complete_points: 0,
      total_complete_points: 0,
      total_points: 0,
      percent_complete_all_points: 0
    };

    var r = 1;
    features.forEach(function(f) {
      f.data.Rank = r;
      summary.total_features += 1;
      summary.total_complete_points += f.get('AcceptedLeafStoryPlanEstimateTotal');
      summary.total_points += f.get('LeafStoryPlanEstimateTotal');

      if (f.get('PercentDoneByStoryCount') == 1) {
        summary.features_complete_stories += 1;
      }
      if (f.get('PercentDoneByStoryPlanEstimate') == 1) {
        summary.features_complete_points += 1;
      }

      r += 1;
    });
    summary.percent_complete_stories = summary.features_complete_stories / summary.total_features;
    summary.percent_complete_points = summary.features_complete_points / summary.total_features;
    summary.percent_complete_all_points = summary.total_complete_points / summary.total_points;

    that.removeAll();

    that.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_feature_complete()">Refresh this dashboard</a><hr />'
    });

    that.build_summary_table(summary);
    that.build_feature_table(features);

    that._mask.hide();
    that.locked = false;
  },

  build_summary_table: function(summary) {
    var that = this;

    var store = Ext.create('Ext.data.Store', {
      fields: Object.keys(summary),
      data: { items: [ summary ] },
      proxy: {
        type: 'memory',
        reader: {
          type: 'json',
          root: 'items'
        }
      }
    });

    var w = 70;
    that.add({
      xtype: 'gridpanel',
      title: 'Features Summary Statistics',
      store: store,
      columns: [{
        text: 'Features<br />Complete<br />(by stories)',
        dataIndex: 'features_complete_stories',
        width: w
      }, {
        text: 'Features<br />Complete<br />(by points)',
        dataIndex: 'features_complete_points',
        width: w
      }, {
        text: 'Total<br />Features<br />Committed',
        dataIndex: 'total_features',
        width: w
      }, {
        text: 'Percent<br />Features<br />Complete<br />(by stories)',
        dataIndex: 'percent_complete_stories',
        renderer: that.percent_renderer,
        width: w
      }, {
        text: 'Percent<br />Features<br />Complete<br />(by points)',
        dataIndex: 'percent_complete_points',
        renderer: that.percent_renderer,
        width: w
      }, {
        text: 'Total<br />Points<br />Completed',
        dataIndex: 'total_complete_points',
        width: w
      }, {
        text: 'Total<br />Points<br />Committed',
        dataIndex: 'total_points',
        width: w
      }, {
        text: 'Percent<br />Points<br />Complete',
        dataIndex: 'percent_complete_all_points',
        renderer: that.percent_renderer,
        width: w
      }],
      width: 8 * w + 2
    });
  },

  build_feature_table: function(features) {
    var that = this;

    var store = Ext.create('Ext.data.Store', {
      fields: that.columns.map(function(c) { return c.key; }),
      data: { items: features.map(function(r) { return r.data; }) },
      proxy: {
        type: 'memory',
        reader: {
          type: 'json',
          root: 'items'
        }
      }
    });

    var w = 2;
    that.columns.forEach(function(c) {
      w += c.width;
    });
    that.add({
      xtype: 'gridpanel',
      title: 'All Features This Quarter',
      store: store,
      columns: that.columns.map(function(c) {
        return { 
          text: c.name, 
          dataIndex: c.key, 
          renderer: c.renderer ? that.percent_renderer : null,
          width: c.width,
          align: 'center'
        };
      }),
      width: w
    });
  }
});
