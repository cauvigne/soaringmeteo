import { el, mount, setChildren, setStyle } from 'redom';
import { App } from './App';
import { LatestForecast, LocationForecasts } from './Forecast';
import * as L from 'leaflet';
import { forecastOffsets, periodsPerDay } from './ForecastFilter';
import { columnWidth as meteogramColumnWidth, meteogram, keyWidth } from './Meteogram';

export class ForecastSelect {

  /** Number of hours to add to 00:00Z to be on the morning forecast period (e.g., 9 for Switzerland) */
  readonly morningOffset: number
  /** Number of hours to add to 00:00Z to be on the noon forecast period (e.g., 12 for Switzerland) */
  readonly noonOffset: number
  /** Number of hours to add to 00:00Z to be on the afternoon forecast period (e.g., 15 for Switzerland) */
  readonly afternoonOffset: number
  /** Number of hours to add to 00:00Z to be on the beginning of the forecast (can be 0, 6, 12, or 18) */
  readonly forecastInitOffset: number

  /** Delta with the forecast initialization time */
  private hourOffset: number
  getHourOffset(): number { return this.hourOffset }

  private view: ForecastSelectView

  constructor(private readonly app: App, latestForecast: LatestForecast, containerElement: HTMLElement) {
    // TODO Compute based on user preferred time zone (currently hard-coded for central Europe)
    this.morningOffset      = 9;
    this.noonOffset         = 12;
    this.afternoonOffset    = 15;
    this.forecastInitOffset = +latestForecast.init.getUTCHours();
    // Tomorrow, noon period
    this.hourOffset = (this.forecastInitOffset === 0 ? 0 : 24) + this.noonOffset - this.forecastInitOffset;
    this.view = new ForecastSelectView(this, latestForecast.init, containerElement);
  }

  updateHourOffset(value: number): void {
    // TODO Guards
    if (value !== this.hourOffset) {
      this.hourOffset = value;
      this.app.forecastLayer.updateForecast();
      this.view.updateSelectedForecast();
    }
  }
  // TODO fix bug
  selectMorning(): void {
    this.updateHourOffset(Math.floor((this.hourOffset + this.forecastInitOffset) / 24) * 24 + this.morningOffset - this.forecastInitOffset);
  }
  selectNoon(): void {
    this.updateHourOffset(Math.floor((this.hourOffset + this.forecastInitOffset) / 24) * 24 + this.noonOffset - this.forecastInitOffset);
  }
  selectAfternoon(): void {
    this.updateHourOffset(Math.floor((this.hourOffset + this.forecastInitOffset) / 24) * 24 + this.afternoonOffset - this.forecastInitOffset);
  }
  nextDay(): void {
    this.updateHourOffset(Math.min(this.hourOffset + 24, 186 /* TODO Store this setting somewhere */));
  }
  nextPeriod(): void {
    // TODO jump to next day morning if we are on the afternoon period
    this.updateHourOffset(Math.min(this.hourOffset + 3, 186));
  }
  previousPeriod(): void {
    // TODO jump to previous day afternoon if we are on the morning period
    this.updateHourOffset(Math.max(this.hourOffset - 3, 3));
  }
  previousDay(): void {
    this.updateHourOffset(Math.max(this.hourOffset - 24, 3));
  }

  showMeteogram(forecasts: LocationForecasts): void {
    const [leftKeyElement, meteogramElement, rightKeyElement] = meteogram(forecasts);
    const forecastOffsetAndDates: Array<[number, Date]> =
      forecasts.dayForecasts
        .map(_ => _.forecasts)
        .reduce((x, y) => x.concat(y), [])
        .map(forecast => {
          const hourOffset =
            (forecast.time.getTime() - forecasts.initializationTime().getTime()) / 3600000;
          return [hourOffset, forecast.time]
        });
    this.view.showMeteogram(leftKeyElement, meteogramElement, rightKeyElement, forecastOffsetAndDates);
  }

  hideMeteogram(): void {
    this.view.hideMeteogram();
  }

}

export class ForecastSelectView {

  readonly rootElement: HTMLElement
  readonly currentDayEl: HTMLElement
  private periodSelectorEl: HTMLElement;
  private meteogramEl: HTMLElement
  private meteogramKeyEl: HTMLElement
  private readonly marginLeft: number;

  constructor(readonly forecastSelect: ForecastSelect, readonly forecastInitDateTime: Date, containerElement: HTMLElement) {

    this.meteogramEl = el('div'); // Filled later by showMeteogram
    this.marginLeft = keyWidth;
    const marginTop = 35; // Day height + hour height + 2 (wtf)
    this.meteogramKeyEl = el('div', { style: { position: 'absolute', width: `${this.marginLeft}px`, left: 0, top: `${marginTop}px`, backgroundColor: 'white' } });

    const buttonStyle = { padding: '0.2em', display: 'inline-block', cursor: 'pointer', border: 'thin solid darkGray' };
    this.currentDayEl = el('div'); // Will be filled later by `updateSelectedForecast`

    const previousDayBtn = this.hover(el('div', { title: '24 hours before', style: { ...buttonStyle } }, '-24'));
    previousDayBtn.onclick = () => { forecastSelect.previousDay(); }

    const previousPeriodBtn = this.hover(el('div', { title: 'Previous forecast period', style: { ...buttonStyle } }, '-3'));
    previousPeriodBtn.onclick = () => { forecastSelect.previousPeriod(); }

    const nextPeriodBtn = this.hover(el('div', { title: 'Next forecast period', style: { ...buttonStyle } }, '+3'));
    nextPeriodBtn.onclick = () => { forecastSelect.nextPeriod(); }

    const nextDayBtn = this.hover(el('div', { title: '24 hours after', style: { ...buttonStyle } }, '+24'));
    nextDayBtn.onclick = () => { forecastSelect.nextDay(); }

    this.periodSelectorEl =
      this.periodSelectorElement(forecastOffsets(forecastInitDateTime, forecastSelect.morningOffset));

    this.rootElement =
      el(
        'span',
        { style: { position: 'absolute', top: 0, left: 0, zIndex: 1000, maxWidth: '100%', userSelect: 'none', cursor: 'default' } },
        this.meteogramKeyEl,
        // Period selector
        this.periodSelectorEl,
        // Current period
        el(
          'div',
          { style: { width: '100px', backgroundColor: 'white' } },
          this.currentDayEl,
          el('div', previousDayBtn, previousPeriodBtn, nextPeriodBtn, nextDayBtn)
        ),
      );
    L.DomEvent.disableClickPropagation(this.rootElement);
    L.DomEvent.disableScrollPropagation(this.rootElement);
    this.updateSelectedForecast();
    mount(containerElement, this.rootElement);
  }

  private hover(htmlEl: HTMLElement): HTMLElement {
    htmlEl.onmouseenter = () => htmlEl.style.backgroundColor = 'lightGray';
    htmlEl.onmouseleave = () => {
      htmlEl.style.backgroundColor = 'inherit';
      this.updateSelectedForecast();
    }
    return htmlEl
  }

  private hoursForPeriod(utcOffset: number): number {
    const date = new Date(this.forecastInitDateTime);
    date.setUTCHours(utcOffset);
    return date.getHours()
  }

  /** Update the view according to the selected forecast period */
  updateSelectedForecast(): void {
    const forecastDateTime = new Date(this.forecastInitDateTime);
    forecastDateTime.setUTCHours(this.forecastInitDateTime.getUTCHours() + this.forecastSelect.getHourOffset());
    this.currentDayEl.textContent = forecastDateTime.toLocaleString(undefined, { month: 'long', weekday: 'short', day: 'numeric', hour12: false, hour: 'numeric', minute: 'numeric' });
  }

  private periodStyle(periodOffset: number): object {
    if ((this.forecastSelect.getHourOffset() + this.forecastSelect.forecastInitOffset) % 24 === periodOffset) {
      return { backgroundColor: '#999' }
    } else {
      return { backgroundColor: 'inherit' }
    }
  }

  showMeteogram(leftKey: HTMLElement, meteogram: HTMLElement, rightKey: HTMLElement, forecastOffsetAndDates: Array<[number, Date]>): void {
    const updatedPeriodSelectorEl = this.periodSelectorElement(forecastOffsetAndDates);
    mount(this.rootElement, updatedPeriodSelectorEl, this.periodSelectorEl, /* replace = */ true);
    this.periodSelectorEl = updatedPeriodSelectorEl;
    setChildren(this.meteogramKeyEl, [leftKey]);
    setChildren(this.meteogramEl, [meteogram, rightKey /* HACK Temporary... at some point we want to polish the layout... */]);
  }

  hideMeteogram(): void {
    setChildren(this.meteogramKeyEl, []);
    setChildren(this.meteogramEl, []);
  }

  private periodSelectorElement(forecastOffsetAndDates: Array<[number, Date]>): HTMLElement {
    const flatPeriodSelectors: Array<[HTMLElement, Date]> = 
      forecastOffsetAndDates
        .map(([gfsOffset, date]) => {
          const htmlEl = el(
            'span',
            { style: { display: 'inline-block', cursor: 'pointer', border: 'thin solid darkGray', width: `${meteogramColumnWidth}px`, lineHeight: '20px', boxSizing: 'border-box', textAlign: 'center' } },
            date.toLocaleTimeString(undefined, { hour12: false, hour: 'numeric' })
          );
          htmlEl.onclick = () => { this.forecastSelect.updateHourOffset(gfsOffset); };
          this.hover(htmlEl);
          return [htmlEl, date]
        });

    const periodSelectorsByDay: Array<[Array<HTMLElement>, Date]> = [];
    let lastDay: number | null = null;
    flatPeriodSelectors.forEach(([hourSelector, date]) => {
      if (date.getDay() === lastDay) {
        // Same group as previous
        periodSelectorsByDay[periodSelectorsByDay.length - 1][0].push(hourSelector);
      } else {
        // New group
        periodSelectorsByDay.push([[hourSelector], date]);
      }
      lastDay = date.getDay();
    });

    const periodSelectors =
      periodSelectorsByDay.map(([periods, date]) => {
        return el(
          'div',
          { style: { display: 'inline-block' } },
          // Day
          el(
            'div',
            { style: { width: `${periods.length * meteogramColumnWidth}px`, textAlign: 'center', boxSizing: 'border-box', borderRight: 'thin solid darkGray', borderLeft: 'thin solid darkGray', lineHeight: '13px' } },
            periods.length === periodsPerDay ?
              date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', weekday: 'short' }) :
              '\xa0'
          ),
          // Periods in each day
          el('div', { style: { textAlign: 'right' } }, periods)
        )
      });

    const length = periodSelectorsByDay.reduce((n, ss) => n + ss[0].length, 0);
    const scrollablePeriodSelector =
      el(
        'div',
        { style: { overflowX: 'auto', marginLeft: `${this.marginLeft}px`, backgroundColor: 'white' } },
        el(
          'div',
          { style: { width: `${length * meteogramColumnWidth + this.marginLeft}px` } },
          el('div', periodSelectors),
          this.meteogramEl
        )
      );
    return scrollablePeriodSelector
  }

}
