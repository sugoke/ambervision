/*
Template Name: HUD - Responsive Bootstrap 5 Admin Template
Version: 1.1.0
Author: Sean Ngu
Website: http://www.seantheme.com/hud/
*/

var lineChart, barChart, radarChart, polarAreaChart, pieChart, doughnutChart;

var handleRenderChartJs = function() {
	Chart.defaults.font.family = FONT_FAMILY;
	Chart.defaults.color = hexToRgba(COLOR_WHITE, .5);
	Chart.defaults.plugins.legend.display = false;
	Chart.defaults.plugins.tooltip.padding = 8;
	Chart.defaults.plugins.tooltip.backgroundColor = hexToRgba(COLOR_GRAY_800, .95);
	Chart.defaults.plugins.tooltip.titleFont.family = FONT_FAMILY;
	Chart.defaults.plugins.tooltip.titleFont.weight = 600;
	Chart.defaults.plugins.tooltip.footerFont.family = FONT_FAMILY;
	Chart.defaults.scale.grid.color = hexToRgba(COLOR_WHITE, .25);
	Chart.defaults.scale.ticks.backdropColor = hexToRgba(COLOR_WHITE, 0);
	
	
	var ctx = document.getElementById('lineChart');
	lineChart = new Chart(ctx, {
		type: 'line',
		data: {
			labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
			datasets: [{
				color: COLOR_THEME,
				backgroundColor: hexToRgba(COLOR_THEME, .2),
				borderColor: COLOR_THEME,
				borderWidth: 1.5,
				pointBackgroundColor: COLOR_THEME,
				pointBorderWidth: 1.5,
				pointRadius: 4,
				pointHoverBackgroundColor: COLOR_THEME,
				pointHoverBorderColor: COLOR_THEME,
				pointHoverRadius: 7,
				label: 'Total Sales',
				data: [12, 19, 4, 5, 2, 3]
			}]
		}
	});
	
	var ctx2 = document.getElementById('barChart');
	barChart = new Chart(ctx2, {
		type: 'bar',
		data: {
			labels: ['Jan','Feb','Mar','Apr','May','Jun'],
			datasets: [{
				label: 'Total Visitors',
				data: [37,31,36,34,43,31],
				backgroundColor: hexToRgba(COLOR_THEME, .5),
				borderColor: COLOR_THEME,
				borderWidth: 1.5
			},{
				label: 'New Visitors',
				data: [12,16,20,14,23,21],
				backgroundColor: hexToRgba(COLOR_WHITE, .5),
				borderColor: hexToRgba(COLOR_WHITE, .65),
				borderWidth: 1.5
			}]
		}
	});
	
	var ctx3 = document.getElementById('radarChart');
	radarChart = new Chart(ctx3, {
		type: 'radar',
		data: {
			labels: ['United States', 'Canada', 'Australia', 'Netherlands', 'Germany', 'New Zealand', 'Singapore'],
			datasets: [
				{
					label: 'Mobile',
					backgroundColor: hexToRgba(COLOR_THEME, .2),
					borderColor: COLOR_THEME,
					pointBackgroundColor: COLOR_THEME,
					pointBorderColor: COLOR_THEME,
					pointHoverBackgroundColor: COLOR_THEME,
					pointHoverBorderColor: COLOR_THEME,
					data: [65, 59, 90, 81, 56, 55, 40],
					borderWidth: 1.5
				},
				{
					label: 'Desktop',
					backgroundColor: hexToRgba(COLOR_GRAY_500, .2),
					borderColor: COLOR_GRAY_500,
					pointBackgroundColor: COLOR_GRAY_500,
					pointBorderColor: COLOR_GRAY_500,
					pointHoverBackgroundColor: COLOR_GRAY_500,
					pointHoverBorderColor: COLOR_GRAY_500,
					data: [28, 48, 40, 19, 96, 27, 100],
					borderWidth: 1.5
				}
			]
		}
	});
	
	var ctx4 = document.getElementById('polarAreaChart');
	polarAreaChart = new Chart(ctx4, {
		type: 'polarArea',
		data: {
			datasets: [{
				data: [11, 16, 7, 3, 14],
				backgroundColor: [hexToRgba(COLOR_THEME, .5), hexToRgba(COLOR_WHITE, .5), hexToRgba(COLOR_GRAY_300, .5), hexToRgba(COLOR_GRAY_500, .5), hexToRgba(COLOR_GRAY_800, .5)],
				borderWidth: 0
			}],
			labels: ['IE', 'Safari', 'Chrome', 'Firefox', 'Opera']
		}
	});
	
	var ctx5 = document.getElementById('pieChart');
	pieChart = new Chart(ctx5, {
		type: 'pie',
		data: {
			labels: ['Total Visitor', 'New Visitor', 'Returning Visitor'],
			datasets: [{
				data: [300, 50, 100],
				backgroundColor: [hexToRgba(COLOR_THEME, .5), hexToRgba(COLOR_WHITE, .5), hexToRgba(COLOR_GRAY_900, .5)],
				hoverBackgroundColor: [hexToRgba(COLOR_THEME, 1), hexToRgba(COLOR_WHITE, 1), hexToRgba(COLOR_GRAY_900, 1)],
				borderWidth: 0
			}]
		}
	});
	
	var ctx6 = document.getElementById('doughnutChart');
	doughnutChart = new Chart(ctx6, {
		type: 'doughnut',
		data: {
			labels: ['Total Visitor', 'New Visitor', 'Returning Visitor'],
			datasets: [{
				data: [300, 50, 100],
				backgroundColor: [hexToRgba(COLOR_THEME, .5), hexToRgba(COLOR_WHITE, .5), hexToRgba(COLOR_GRAY_900, .5)],
				hoverBackgroundColor: [COLOR_THEME, COLOR_WHITE, COLOR_GRAY_900],
				borderWidth: 0
			}]
		}
	});
};

/* Controller
------------------------------------------------ */
$(document).ready(function() {
	handleRenderChartJs();
	
	$(document).on('theme-reload', function() {
		lineChart.destroy();
		barChart.destroy();
		radarChart.destroy();
		polarAreaChart.destroy();
		pieChart.destroy();
		doughnutChart.destroy();
		
		handleRenderChartJs();
	});
	
});