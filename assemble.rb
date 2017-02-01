DASHBOARDS_PLACEHOLDER = "<!-- put the dashboards here -->"
MENU_PLACEHOLDER = "<!-- put the menu here -->"

team_out = File.open("templates/team.html", "r").read
program_out = File.open("templates/program.html", "r").read

all_work = File.open("dashboards/all_work.js", "r").read
feature = File.open("dashboards/feature.js", "r").read
initiative = File.open("dashboards/initiative.js", "r").read
team = File.open("dashboards/team.js", "r").read
weekly = File.open("dashboards/weekly_throughput.js", "r").read

team_dashboards = [all_work, team, weekly].join("\n")
program_dashboards = [all_work, feature, initiative, weekly].join("\n")

team_menu = File.open("menus/team.html", "r").read
  .gsub("\"", "\\\"")
  .gsub("\n", " ")
program_menu = File.open("menus/program.html", "r").read
  .gsub("\"", "\\\"")
  .gsub("\n", " ")

team_out.gsub!(DASHBOARDS_PLACEHOLDER, team_dashboards)
team_out.gsub!(MENU_PLACEHOLDER, team_menu)
program_out.gsub!(DASHBOARDS_PLACEHOLDER, program_dashboards)
program_out.gsub!(MENU_PLACEHOLDER, program_menu)

File.open("team_dashboard.html", "w") do |f|
  f << team_out
end
File.open("program_dashboard.html", "w") do |f|
  f << program_out
end
