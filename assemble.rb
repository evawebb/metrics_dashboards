MENU_PLACEHOLDER = "<!-- put the menu here -->"
DASHBOARDS_PLACEHOLDER = "// put the dashboards here"
STYLE_PLACEHOLDER = "/* put the style here */"

team_out = File.open("templates/team.html", "r").read
program_out = File.open("templates/program.html", "r").read
just_team_out = File.open("templates/just_team.html", "r").read

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

style = File.open("style.css", "r").read

team_out.gsub!(MENU_PLACEHOLDER, team_menu)
team_out.gsub!(STYLE_PLACEHOLDER, style)
team_out.gsub!(DASHBOARDS_PLACEHOLDER, team_dashboards)
program_out.gsub!(MENU_PLACEHOLDER, program_menu)
program_out.gsub!(STYLE_PLACEHOLDER, style)
program_out.gsub!(DASHBOARDS_PLACEHOLDER, program_dashboards)
just_team_out.gsub!(STYLE_PLACEHOLDER, style)
just_team_out.gsub!(DASHBOARDS_PLACEHOLDER, team)

File.open("team_dashboard.html", "w") do |f|
  f << team_out
end
File.open("program_dashboard.html", "w") do |f|
  f << program_out
end
File.open("just_team_dashboard.html", "w") do |f|
  f << just_team_out
end
