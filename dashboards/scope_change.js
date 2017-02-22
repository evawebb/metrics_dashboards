Ext.define('ZzacksScopeChangeDashboardApp', {
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

    var release = this.getContext().getTimeboxScope().record.raw.Name;
    var that = this;
    this.start(function() {
      that.fetch_features(release);
    });
  },

  onTimeboxScopeChange: function(ts) {
  },

  refresh: function() {
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
          value: release
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
              scope_act: 0,
              scope_chg: -f.get('RefinedEstimate')
            };
          });

          that.fetch_stories(records, data);
          // that.build_table(data);
        } else {
          that.haltEarly('No features found.');
        }
      }
    });
  },

  fetch_stories: function(features, data) {
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

          if (features.length == 0) {
            that.build_table(data, that.sort_data(Object.keys(data), data));
          } else {
            that.fetch_stories(features, data);
          }
        }
      }
    });
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

    var table = '<table class="center">' +
      '<thead><tr>' + 
      '<th class="bold tablecell">Formatted ID</th>' +
      '<th class="bold tablecell">Name</th>' + 
      '<th class="bold tablecell">Refined Estimate</th>' + 
      '<th class="bold tablecell">Actual Scope</th>' +
      '<th class="bold tablecell">Scope Change</th>' +
      '</tr></thead>';

    fids.forEach(function(fid) {
      table += '<tr>';
      table += '<td class="tablecell center">';
      table += fid + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].name + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_est + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_act + '</td>';
      table += '<td class="tablecell center">';
      table += data[fid].scope_chg + '</td>';
      table += '</tr>';
    });

    table += '</table>';

    this.add({
      xtype: 'component',
      html: table
    });

    this._mask.hide();
    this.locked = false;
  }
});
