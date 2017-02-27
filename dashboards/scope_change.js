Ext.define('ZzacksScopeChangeDashboardApp', {
  extend: 'Rally.app.TimeboxScopedApp',
  scopeType: 'release',
  histories_cluster_size: 200,

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

    var release = this.getContext().getTimeboxScope();
    var that = this;
    this.start(function() {
      that.release = release;
      that.fetch_features(release);
    });
  },

  onTimeboxScopeChange: function(ts) {
    var that = this;
    this.start(function() {
      that.release = ts;
      that.fetch_features(that.release);
    });
  },

  refresh: function() {
    var that = this;
    this.start(function() {
      that.fetch_features(that.release);
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
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_scope_change()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: 'Error: ' + msg
    });
    this.locked = false;
  },

  fetch_features: function(release) {
    this._mask.msg = 'Fetching features...';
    this._mask.show();

    var that = this;

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['PortfolioItem/Feature'],
      filters: [
        {
          property: 'Release.Name',
          value: release.record.raw.Name
        }
      ]
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Features query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');
        if (operation.wasSuccessful()) {
          var data = {};
          records.forEach(function(f) {
            data[f.get('FormattedID')] = {
              name: f.get('Name'),
              scope_est: f.get('RefinedEstimate'),
              scope_est_h: 0,
              scope_act: 0,
              scope_chg: -f.get('RefinedEstimate')
            };
          });

          that.fetch_stories(release, records, data, []);
        } else {
          that.haltEarly('No features found.');
        }
      }
    });
  },

  fetch_stories: function(release, features, data, stories) {
    this._mask.msg = 'Fetching stories...';
    this._mask.show();

    var that = this;

    var feature_oids = features.splice(0, 50).map(function(f) {
      return f.get('ObjectID');
    });

    var store = Ext.create('Rally.data.wsapi.artifact.Store', {
      models: ['UserStory', 'Defect'],
      filters: [
        {
          property: 'Feature.ObjectID',
          operator: 'in',
          value: feature_oids
        },
        {
          property: 'DirectChildrenCount',
          value: 0
        }
      ],
      limit: 2000
    }, this);
    var t1 = new Date();
    store.load({
      scope: this,
      callback: function(records, operation) {
        var t2 = new Date();
        console.log('Stories query took', (t2 - t1), 'ms, and retrieved', records ? records.length : 0, 'results.');
        if (operation.wasSuccessful()) {
          records.forEach(function(s) {
            var ffid = s.get('Feature').FormattedID;
            if (data[ffid]) {
              data[ffid].scope_act += s.get('PlanEstimate');
              data[ffid].scope_chg += s.get('PlanEstimate');
            } else {
              console.log('Weird story!', s);
            }
          });
          stories = stories.concat(records);
        }

        if (features.length == 0) {
          that.fetch_historical_estimates(release, stories, data);
        } else {
          that.fetch_stories(release, features, data, stories);
        }
      }
    });
  },

  fetch_historical_estimates: function(release, stories, data) {
    this._mask.msg = 'Fetching feature estimates... (' + stories.length + ' stories left)';
    this._mask.show();

    var that = this;

    var story_oids = stories.splice(0, this.histories_cluster_size);
    var feature_fids = {};
    story_oids.forEach(function(s) {
      feature_fids[s.get('ObjectID')] = s.get('Feature').FormattedID;
    });
    story_oids = story_oids.map(function(s) {
      return s.get('ObjectID');
    });

    var store = Ext.create('Rally.data.lookback.SnapshotStore', {
      fetch: ['Name', 'FormattedID', 'PlanEstimate', 'Feature'],
      hydrate: ['Feature'],
      filters: [
        {
          property: 'ObjectID',
          operator: 'in',
          value: story_oids
        },
        {
          property: '_ValidFrom',
          operator: '>',
          value: release.record.raw.ReleaseStartDate
        },
        {
          property: '_ValidFrom',
          operator: '<',
          value: release.record.raw.ReleaseDate
        }
      ],
      listeners: {
        load: function(store, lb_data, success) {
          var done = {};
          lb_data.forEach(function(m) {
            if (
              !done[m.get('ObjectID')] &&
              m.get('Feature') &&
              feature_fids[m.get('ObjectID')] &&
              data[feature_fids[m.get('ObjectID')]]
            ) {
              data[feature_fids[m.get('ObjectID')]].scope_est_h += m.get('PlanEstimate');
              done[m.get('ObjectID')] = true;
            }
          });
              
          if (stories.length == 0) {
            that.build_table(data, that.sort_data(Object.keys(data), data));
          } else {
            that.fetch_historical_estimates(release, stories, data);
          }
        }
      }
    });
    store.load({ scope: this });
  },

  sort_data: function(fids, data) {
    if (fids.length > 1) {
      var pivot = fids[0];
      var left = [];
      var right = [];

      for (var i = 1; i < fids.length; i += 1) {
        if (data[fids[i]].scope_chg > data[pivot].scope_chg) {
          left.push(fids[i]);
        } else {
          right.push(fids[i]);
        }
      }

      left = this.sort_data(left, data);
      right = this.sort_data(right, data);
      return left.concat([pivot]).concat(right);
    } else {
      return fids;
    }
  },

  build_table: function(data, fids) {
    this._mask.msg = 'Building table...';
    this._mask.show();

    var that = this;

    var table = '<div class="center title">Scope Change by Feature</div>' +
      '<table class="center">' +
      '<thead><tr>' + 
      '<th class="bold tablecell">Formatted ID</th>' +
      '<th class="bold tablecell">Name</th>' + 
      '<th class="bold tablecell">Refined Estimate</th>' + 
      '<th class="bold tablecell">Refined Estimate (LBAPI)</th>' +
      '<th class="bold tablecell">Actual Scope</th>' +
      '<th class="bold tablecell">Scope Change</th>' +
      '<th class="bold tablecell">Percent Scope Change</th>' +
      '</tr></thead>';

    var totals = {
      scope_est: 0,
      scope_est_h: 0,
      scope_act: 0,
      scope_chg: 0
    };
    fids.forEach(function(fid) {
      table += '<tr>';
      table += '<td class="tablecell center">';
      table += fid + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].name + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_est + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_est_h + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_act + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_chg + '</td>';
      table += '<td class="tablecell center">';
      if (data[fid].scope_est > 0) {
        table += (data[fid].scope_chg / data[fid].scope_est * 100).toFixed(2) + '%</td>';
      } else {
        table += '</td>';
      }
      table += '</tr>';

      Object.keys(totals).forEach(function(k) {
        totals[k] += data[fid][k];
      });
    });
    table += '<tr>';
    table += '<td class="tablecell bold">';
    table += '</td>';
    table += '<td class="tablecell bold">';
    table += 'Total</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_est + '</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_est_h + '</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_act + '</td>';
    table += '<td class="tablecell bold">';
    table += totals.scope_chg + '</td>';
    table += '<td class="tablecell bold">';
    table += (totals.scope_chg / totals.scope_est * 100).toFixed(2) + '%</td>';
    table += '</tr>';

    table += '</table>';

    this.add({
      xtype: 'component',
      html: '<a href="javascript:void(0);" onClick="load_menu()">Choose a different dashboard</a><br /><a href="javascript:void(0);" onClick="refresh_scope_change()">Refresh this dashboard</a><hr />'
    });
    this.add({
      xtype: 'component',
      html: table
    });

    this._mask.hide();
    this.locked = false;
  }
});
