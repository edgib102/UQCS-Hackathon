/**
 * Renders a line chart of hip height and symmetry over time.
 * @param {HTMLCanvasElement} canvas The canvas element to draw the chart on.
 * @param {number[]} hipData An array of hip Y-coordinates.
 * @param {number[]} symmetryData An array of symmetry degrees.
 * @returns {Chart} The Chart.js instance.
 */
export function renderHipHeightChart(canvas, hipData, symmetryData) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  const chartConfig = {
    type: 'line',
    data: {
      labels: hipData.map((_, index) => index),
      datasets: [
        {
          label: 'Hip Height',
          data: hipData,
          borderColor: '#00CFFF',
          backgroundColor: 'rgba(0, 207, 255, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y', // Assign to the left y-axis
        },
        {
          label: 'Symmetry',
          data: symmetryData,
          borderColor: '#FF9E00', // Secondary color
          backgroundColor: 'rgba(255, 158, 0, 0.1)',
          fill: false, // Keep it a clean line
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y1', // Assign to the right y-axis
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, // Display labels for the two lines
          labels: {
            color: '#e0e0e0',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        title: {
            display: true,
            text: 'Form Analysis Over Time',
            color: '#e0e0e0',
            font: {
                family: "'Roboto Mono', monospace",
                size: 16
            }
        }
      },
      scales: {
        y: { // Left Y-Axis (Hip Height)
          type: 'linear',
          position: 'left',
          reverse: true,
          title: {
            display: true,
            text: 'Vertical Position (Lower is Deeper)',
            color: '#00CFFF',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: { color: '#333333' },
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        y1: { // Right Y-Axis (Symmetry)
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Symmetry (deg)',
            color: '#FF9E00',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: { drawOnChartArea: false }, // Don't draw grid lines from this axis
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        x: {
          title: {
            display: true,
            text: 'Time (Frames)',
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: { color: '#333333' },
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        }
      }
    }
  };

  return new Chart(ctx, chartConfig);
}