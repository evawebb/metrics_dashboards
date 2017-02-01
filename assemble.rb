team_out = File.open("team_dashboard_template.html", "r").read
program_out = File.open("program_dashboard_template.html", "r").read

all_work = File.open("all_work_dashboard.js", "r").read
feature = File.open("feature_dashboard.js", "r").read
initiative = File.open("initiative_dashboard.js", "r").read
team = File.open("team_dashboard.js", "r").read
weekly = File.open("weekly_throughput_dashboard.js", "r").read

team_dashboards = [all_work, team, weekly].join("\n")
# program_dashboards = [all_work, feature, initiative, weekly].join("\n")
program_dashboards = feature

team_out.gsub!("<!-- put the things here -->", team_dashboards)
program_out.gsub!("<!-- put the things here -->", program_dashboards)

File.open("team_dashboard.html", "w") do |f|
  f << team_out
end
File.open("program_dashboard.html", "w") do |f|
  f << program_out
end
