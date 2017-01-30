out = File.open("dashboard_template.html", "r").read

all_work = File.open("all_work_dashboard.js", "r").read
feature = File.open("feature_dashboard.js", "r").read
initiative = File.open("initiative_dashboard.js", "r").read
team = File.open("team_dashboard.js", "r").read
weekly = File.open("weekly_throughput_dashboard.js", "r").read

dashboards = [all_work, feature, initiative, team, weekly].join("\n")

out.gsub!("<!-- put the things here -->", dashboards)

File.open("dashboard.html", "w") do |f|
  f << out
end
