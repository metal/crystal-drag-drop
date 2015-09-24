'use strict';

import core from 'bower:metal/src/core';
import dom from 'bower:metal/src/dom/dom';
import object from 'bower:metal/src/object/object';
import Attribute from 'bower:metal/src/attribute/Attribute';
import DragAutoScroll from './helpers/DragAutoScroll';
import DragScrollDelta from './helpers/DragScrollDelta';
import DragShim from './helpers/DragShim';
import EventHandler from 'bower:metal/src/events/EventHandler';
import Position from 'bower:metal-position/src/Position';

/**
 * Responsible for making elements draggable. Handles all the logic
 * for dragging elements. Dropping is handled by `DragDrop`.
 * @extends {Attribute}
 */
class Drag extends Attribute {
	/**
	 * @inheritDoc
	 */
	constructor(opt_config) {
		super(opt_config);

		/**
		 * The drag placeholder that is active at the moment.
		 * @type {Element}
		 * @protected
		 */
		this.activeDragPlaceholder_ = null;

		/**
		 * The drag source that is active at the moment.
		 * @type {Element}
		 * @protected
		 */
		this.activeDragSource_ = null;

		/**
		 * The current x position of the mouse (or null if not dragging).
		 * @type {?number}
		 * @protected
		 */
		this.currentMouseX_ = null;

		/**
		 * The current y position of the mouse (or null if not dragging).
		 * @type {?number}
		 * @protected
		 */
		this.currentMouseY_ = null;

		/**
		 * The current region values of the element being dragged, relative to
		 * the document (or null if not dragging).
		 * @type {Object}
		 * @protected
		 */
		this.currentSourceRegion_ = null;

		/**
		 * The current x position of the element being dragged relative to its
		 * `offsetParent`, or to the viewport if there's no `offsetParent`
		 * (or null if not dragging).
		 * @type {?number}
		 * @protected
		 */
		this.currentSourceRelativeX_ = null;

		/**
		 * The current y position of the element being dragged relative to its
		 * `offsetParent`, or to the viewport if there's no `offsetParent`
		 * (or null if not dragging).
		 * @type {?number}
		 * @protected
		 */
		this.currentSourceRelativeY_ = null;

		/**
		 * The distance that has been dragged.
		 * @type {number}
		 * @protected
		 */
		this.distanceDragged_ = 0;

		/**
		 * Flag indicating if one of the sources are being dragged.
		 * @type {boolean}
		 * @protected
		 */
		this.dragging_ = false;

		/**
		 * The `EventHandler` instance that holds events that keep track of the drag action.
		 * @type {!EventHandler}
		 * @protected
		 */
		this.dragHandler_ = new EventHandler();

		/**
		 * `DragScrollDelta` instance.
		 * @type {!DragScrollDelta}
		 * @protected
		 */
		this.dragScrollDelta_ = new DragScrollDelta();

		/**
		 * The `EventHandler` instance that holds events for the source (or sources).
		 * @type {!EventHandler}
		 * @protected
		 */
		this.sourceHandler_ = new EventHandler();

		this.attachSourceEvents_();
		this.on(Drag.Events.DRAG, this.defaultDragFn_, true);
		this.on(Drag.Events.END, this.defaultEndFn_, true);
		this.on('sourcesChanged', this.handleSourcesChanged_.bind(this));
		this.dragScrollDelta_.on('scrollDelta', this.handleScrollDelta_.bind(this));
		dom.on(document, 'keydown', this.handleKeyDown_.bind(this));
	}

	/**
	 * Attaches the necessary events to the source (or sources).
	 * @protected
	 */
	attachSourceEvents_() {
		var toAttach = {
			keydown: this.handleSourceKeyDown_.bind(this),
			mousedown: this.handleDragStartEvent_.bind(this),
			touchstart: this.handleDragStartEvent_.bind(this)
		};
		var eventTypes = Object.keys(toAttach);
		for (var i = 0; i < eventTypes.length; i++) {
			var listenerFn = toAttach[eventTypes[i]];
			if (core.isString(this.sources)) {
				this.sourceHandler_.add(dom.delegate(this.container, eventTypes[i], this.sources, listenerFn));
			} else {
				this.sourceHandler_.add(dom.on(this.sources, eventTypes[i], listenerFn));
			}
		}
	}

	/**
	 * Builds the object with data to be passed to a drag event.
	 * @return {!Object}
	 * @protected
	 */
	buildEventObject_() {
		return {
			placeholder: this.activeDragPlaceholder_,
			source: this.activeDragSource_,
			relativeX: this.currentSourceRelativeX_,
			relativeY: this.currentSourceRelativeY_,
			x: this.currentSourceRegion_.left,
			y: this.currentSourceRegion_.top
		};
	}

	/**
	 * Calculates the initial positions for the drag action.
	 * @param {!Event} event
	 * @protected
	 */
	calculateInitialPosition_(event) {
		this.currentMouseX_ = event.clientX;
		this.currentMouseY_ = event.clientY;
		this.currentSourceRegion_ = object.mixin({}, Position.getRegion(this.activeDragSource_, true));
		this.currentSourceRelativeX_ = this.activeDragSource_.offsetLeft;
		this.currentSourceRelativeY_ = this.activeDragSource_.offsetTop;
	}

	/**
	 * Checks if the given event can start a drag operation.
	 * @param {!Event} event
	 * @return {boolean}
	 * @protected
	 */
	canStartDrag_(event) {
		return !this.disabled &&
			(!core.isDef(event.button) || event.button === 0) &&
			!this.isDragging() &&
			this.isWithinHandle_(event.target);
	}

	/**
	 * Resets all variables to their initial values and detaches drag listeners.
	 * @protected
	 */
	cleanUpAfterDragging_() {
		if (this.activeDragPlaceholder_) {
			this.activeDragPlaceholder_.setAttribute('aria-grabbed', 'false');
			dom.removeClasses(this.activeDragPlaceholder_, this.draggingClass);
			if (this.dragPlaceholder === Drag.Placeholder.CLONE) {
				dom.exitDocument(this.activeDragPlaceholder_);
			}
		}
		this.activeDragPlaceholder_ = null;
		this.activeDragSource_ = null;
		this.currentSourceRegion_ = null;
		this.currentSourceRelativeX_ = null;
		this.currentSourceRelativeY_ = null;
		this.currentMouseX_ = null;
		this.currentMouseY_ = null;
		this.dragging_ = false;
		this.dragHandler_.removeAllListeners();
	}

	/**
	 * Clones the active drag source and adds the clone to the document.
	 * @return {!Element}
	 * @protected
	 */
	cloneActiveDrag_() {
		var placeholder = this.activeDragSource_.cloneNode(true);
		placeholder.style.position = 'absolute';
		placeholder.style.left = this.currentSourceRelativeX_ + 'px';
		placeholder.style.top = this.currentSourceRelativeY_ + 'px';
		dom.append(this.activeDragSource_.parentNode, placeholder);
		return placeholder;
	}

	/**
	 * Constrains the given region within the region defined by the `constrain` attr.
	 * @param {!Object} region
	 * @protected
	 */
	constrain_(region) {
		var constrain = this.constrain;
		if (constrain) {
			if (core.isElement(constrain)) {
				constrain = Position.getRegion(constrain, true);
			}
			if (region.left < constrain.left) {
				region.left = constrain.left;
			} else if (region.right > constrain.right) {
				region.left -= region.right - constrain.right;
			}
			if (region.top < constrain.top) {
				region.top = constrain.top;
			} else if (region.bottom > constrain.bottom) {
				region.top -= region.bottom - constrain.bottom;
			}
			region.right = region.left + region.width;
			region.bottom = region.top + region.height;
		}
	}

	/**
	 * Creates the active drag placeholder, unless it already exists.
	 * @protected
	 */
	createActiveDragPlaceholder_() {
		var dragPlaceholder = this.dragPlaceholder;
		if (dragPlaceholder === Drag.Placeholder.CLONE) {
			this.activeDragPlaceholder_ = this.cloneActiveDrag_();
		} else if (core.isElement(dragPlaceholder)) {
			this.activeDragPlaceholder_ = dragPlaceholder;
		} else {
			this.activeDragPlaceholder_ = this.activeDragSource_;
		}
	}

	/**
	 * The default behavior for the `Drag.Events.DRAG` event. Can be prevented
	 * by calling the `preventDefault` function on the event's facade. Moves
	 * the placeholder to the new calculated source position.
	 * @protected
	 */
	defaultDragFn_() {
		this.moveToPosition_(this.activeDragPlaceholder_);
	}

	/**
	 * The default behavior for the `Drag.Events.END` event. Can be prevented
	 * by calling the `preventDefault` function on the event's facade. Moves
	 * the source element to the final calculated position.
	 * @protected
	 */
	defaultEndFn_() {
		this.moveToPosition_(this.activeDragSource_);
	}

	/**
	 * @inheritDoc
	 */
	disposeInternal() {
		this.cleanUpAfterDragging_();
		this.dragHandler_ = null;
		this.dragScrollDelta_.dispose();
		this.dragScrollDelta_ = null;
		this.sourceHandler_.removeAllListeners();
		this.sourceHandler_ = null;
		super.disposeInternal();
	}

	/**
	 * Gets the active drag source.
	 * @return {Element}
	 */
	getActiveDrag() {
		return this.activeDragSource_;
	}

	/**
	 * Handles events that can end a drag action, like "mouseup" and "touchend".
	 * Triggered when the mouse drag action ends.
	 * @protected
	 */
	handleDragEndEvent_() {
		if (this.autoScroll) {
			this.autoScroll.stop();
		}
		this.dragScrollDelta_.stop();
		DragShim.hideDocShim();
		this.emit(Drag.Events.END, this.buildEventObject_());
		this.cleanUpAfterDragging_();
	}

	/**
	 * Handles events that can move a draggable element, like "mousemove" and "touchmove".
	 * Tracks the movement on the screen to update the drag action.
	 * @param {!Event} event
	 * @protected
	 */
	handleDragMoveEvent_(event) {
		var position = event.targetTouches ? event.targetTouches[0] : event;
		var distanceX = position.clientX - this.currentMouseX_;
		var distanceY = position.clientY - this.currentMouseY_;
		this.currentMouseX_ = position.clientX;
		this.currentMouseY_ = position.clientY;
		if (!this.isDragging() && !this.hasReachedMinimumDistance_(distanceX, distanceY)) {
			return;
		}

		if (!this.isDragging()) {
			this.startDragging_();
			this.dragScrollDelta_.start(this.activeDragPlaceholder_, this.scrollContainers);
		}
		if (this.autoScroll) {
			this.autoScroll.scroll(this.scrollContainers, this.currentMouseX_, this.currentMouseY_);
		}
		this.updatePosition(distanceX, distanceY);
	}

	/**
	 * Handles events that can start a drag action, like "mousedown" and "touchstart".
	 * When this is triggered and the sources were not already being dragged, more
	 * listeners will be attached to keep track of the drag action.
	 * @param {!Event} event
	 * @protected
	 */
	handleDragStartEvent_(event) {
		this.activeDragSource_ = event.delegateTarget || event.currentTarget;

		if (this.canStartDrag_(event)) {
			this.calculateInitialPosition_(event.targetTouches ? event.targetTouches[0] : event);
			event.preventDefault();
			if (event.type === 'keydown') {
				this.startDragging_();
			} else {
				this.dragHandler_.add.apply(
					this.dragHandler_,
					DragShim.attachDocListeners(this.useShim, {
						mousemove: this.handleDragMoveEvent_.bind(this),
						touchmove: this.handleDragMoveEvent_.bind(this),
						mouseup: this.handleDragEndEvent_.bind(this),
						touchend: this.handleDragEndEvent_.bind(this)
					})
				);
				this.distanceDragged_ = 0;
			}
		}
	}

	/**
	 * Handles a `keydown` event on the document. Ends the drag if ESC was the pressed key.
	 * @param {!Event} event
	 * @protected
	 */
	handleKeyDown_(event) {
		if (event.keyCode === 27 && this.isDragging()) {
			this.handleDragEndEvent_();
		}
	}

	/**
	 * Handles a "scrollDelta" event. Updates the position data for the source,
	 * as well as the placeholder's position on the screen when "move" is set to true.
	 * @param {!Object} event [description]
	 * @protected
	 */
	handleScrollDelta_(event) {
		this.updatePosition(event.deltaX, event.deltaY);
	}

	/**
	 * Handles a `keydown` event from `KeyboardDrag`. Does the appropriate drag action
	 * for the pressed key.
	 * @param {!Object} event
	 * @protected
	 */
	handleSourceKeyDown_(event) {
		if (this.isDragging()) {
			var currentTarget = event.delegateTarget || event.currentTarget;
			if (currentTarget !== this.activeDragSource_) {
				return;
			}
			if (event.keyCode >= 37 && event.keyCode <= 40) {
				// Arrow keys during drag move the source.
				var deltaX = 0;
				var deltaY = 0;
				if (event.keyCode === 37) {
					deltaX -= this.keyboardSpeed;
				} else if (event.keyCode === 38) {
					deltaY -= this.keyboardSpeed;
				} else if (event.keyCode === 39) {
					deltaX += this.keyboardSpeed;
				} else {
					deltaY += this.keyboardSpeed;
				}
				this.updatePosition(deltaX, deltaY);
				event.preventDefault();
			} else if (event.keyCode === 13 || event.keyCode === 32 || event.keyCode === 27) {
				// Enter, space or esc during drag will end it.
				this.handleDragEndEvent_();
			}
		} else if (event.keyCode === 13 || event.keyCode === 32) {
			// Enter or space will start the drag action.
			this.handleDragStartEvent_(event);
		}
	}

	/**
	 * Triggers when the `sources` attribute changes. Detaches events attached to the
	 * previous sources and attaches them to the new value instead.
	 * @protected
	 */
	handleSourcesChanged_() {
		this.sourceHandler_.removeAllListeners();
		this.attachSourceEvents_();
	}

	/**
	 * Checks if the minimum distance for dragging has been reached after
	 * adding the given values.
	 * @param {number} distanceX
	 * @param {number} distanceY
	 * @return {boolean}
	 * @protected
	 */
	hasReachedMinimumDistance_(distanceX, distanceY) {
		this.distanceDragged_ += Math.abs(distanceX) + Math.abs(distanceY);
		return this.distanceDragged_ >= this.minimumDragDistance;
	}

	/**
	 * Checks if one of the sources are being dragged.
	 * @return {boolean}
	 */
	isDragging() {
		return this.dragging_;
	}

	/**
	 * Checks if the given element is within a valid handle.
	 * @param {!Element} element
	 * @protected
	 */
	isWithinHandle_(element) {
		var handles = this.handles;
		if (!handles) {
			return true;
		} else if (core.isString(handles)) {
			return dom.match(element, handles + ', ' + handles + ' *');
		} else {
			return dom.contains(handles, element);
		}
	}

	/**
	 * Moves the given element to the current source coordinates.
	 * @param {!Element} element
	 * @protected
	 */
	moveToPosition_(element) {
		element.style.left = this.currentSourceRelativeX_ + 'px';
		element.style.top = this.currentSourceRelativeY_ + 'px';
	}

	/**
	 * Setter for the `autoScroll` attribute.
	 * @param {*} val
	 * @return {!DragAutoScroll}
	 */
	setterAutoScrollFn_(val) {
		if (val !== false) {
			return new DragAutoScroll(val);
		}
	}

	/**
	 * Setter for the `constrain` attribute.
	 * @param {!Element|Object|string} val
	 * @return {!Element|Object}
	 * @protected
	 */
	setterConstrainFn(val) {
		if (core.isString(val)) {
			val = dom.toElement(val);
		}
		return val;
	}

	/**
	 * Sets the `scrollContainers` attribute.
	 * @param {Element|string} scrollContainers
	 * @return {!Array<!Element>}
	 * @protected
	 */
	setterScrollContainersFn_(scrollContainers) {
		var elements = this.toElements_(scrollContainers);
		elements.push(document);
		return elements;
	}

	/**
	 * Starts dragging the selected source.
	 * @protected
	 */
	startDragging_() {
		this.dragging_ = true;
		this.createActiveDragPlaceholder_();
		dom.addClasses(this.activeDragPlaceholder_, this.draggingClass);
		this.activeDragPlaceholder_.setAttribute('aria-grabbed', 'true');
	}

	/**
	 * Converts the given element or selector into an array of elements.
	 * @param {Element|string} elementOrSelector
	 * @return {!Array<!Element>}
	 * @protected
	 */
	toElements_(elementOrSelector) {
		if (core.isString(elementOrSelector)) {
			var matched = this.container.querySelectorAll(elementOrSelector);
			return Array.prototype.slice.call(matched, 0);
		} else if (elementOrSelector) {
			return [elementOrSelector];
		} else {
			return [];
		}
	}

	/**
	 * Updates the dragged element's position, moving its placeholder if `move`
	 * is set to true.
	 * @param {number} deltaX
	 * @param {number} deltaY
	 */
	updatePosition(deltaX, deltaY) {
		if (this.axis === 'x') {
			deltaY = 0;
		} else if (this.axis === 'y') {
			deltaX = 0;
		}

		var newRegion = object.mixin({}, this.currentSourceRegion_);
		newRegion.left += deltaX;
		newRegion.right += deltaX;
		newRegion.top += deltaY;
		newRegion.bottom += deltaY;
		this.constrain_(newRegion);
		deltaX = newRegion.left - this.currentSourceRegion_.left;
		deltaY = newRegion.top - this.currentSourceRegion_.top;

		if (deltaX !== 0 || deltaY !== 0) {
			this.currentSourceRegion_ = newRegion;
			this.currentSourceRelativeX_ += deltaX;
			this.currentSourceRelativeY_ += deltaY;
			this.emit(Drag.Events.DRAG, this.buildEventObject_());
		}
	}

	/**
	 * Validates the given value, making sure that it's either an element or a string.
	 * @param {*} val
	 * @return {boolean}
	 * @protected
	 */
	validateElementOrString_(val) {
		return core.isString(val) || core.isElement(val);
	}

	/**
	 * Validates the value of the `constrain` attribute.
	 * @param {*} val
	 * @return {boolean}
	 * @protected
	 */
	validatorConstrainFn(val) {
		return core.isString(val) || core.isObject(val);
	}
}

/**
 * Attributes definition.
 * @type {!Object}
 * @static
 */
Drag.ATTRS = {
	/**
	 * Configuration object for the `DragAutoScroll` instance that will be used for
	 * automatically scrolling the elements in `scrollContainers` during drag when
	 * the mouse is near their boundaries. If set to `false`, auto scrolling will be
	 * disabled (default).
	 * @type {!Object|boolean}
	 * @default false
	 */
	autoScroll: {
		setter: 'setterAutoScrollFn_',
		value: false,
		writeOnce: true
	},

	/**
	 * The axis that allows dragging. Can be set to just x, just y or both (default).
	 * @type {string}
	 */
	axis: {
		validator: core.isString
	},

	/**
	 * Object with the boundaries, that the dragged element should not leave
	 * while being dragged. If not set, the element is free to be dragged
	 * to anywhere on the page. Can be either already an object with the
	 * boundaries relative to the document, or an element to use the boundaries
	 * from, or even a selector for finding that element.
	 * @type {!Element|Object|string}
	 */
	constrain: {
		setter: 'setterConstrainFn',
		validator: 'validatorConstrainFn'
	},

	/**
	 * An element that contains all sources, targets and scroll containers. This
	 * will be used when delegate events are attached or when looking for elements
	 * by selector. Defaults to `document`.
	 * @type {!Element|string}
	 * @default document
	 */
	container: {
		setter: dom.toElement,
		validator: 'validateElementOrString_',
		value: document
	},

	/**
	 * Flag indicating if drag operations are disabled. When set to true, it
	 * dragging won't work.
	 * @type {boolean}
	 * @default false
	 */
	disabled: {
		validator: core.isBoolean,
		value: false
	},

	/**
	 * The CSS class that should be added to the node being dragged.
	 * @type {string}
	 * @default 'dragging'
	 */
	draggingClass: {
		validator: core.isString,
		value: 'dragging'
	},

	/**
	 * The placeholder element that should be moved during drag. Can be either
	 * an element or the "clone" string, indicating that a clone of the source
	 * being dragged should be used. If nothing is set, the original source element
	 * will be used.
	 * @type {Element|?string}
	 */
	dragPlaceholder: {
		validator: 'validateElementOrString_'
	},

	/**
	 * Elements inside the source that should be the drag handles. Can be
	 * either a single element or a selector for multiple elements.
	 * @type {Element|?string}
	 */
	handles: {
		validator: 'validateElementOrString_'
	},

	/**
	 * The number of pixels that the source should move when dragged via
	 * the keyboard controls.
	 * @default 10
	 */
	keyboardSpeed: {
		validator: core.isNumber,
		value: 10
	},

	/**
	 * The minimum distance, in pixels, that the mouse needs to move before
	 * the action is considered a drag.
	 * @type {number}
	 * @default 5
	 */
	minimumDragDistance: {
		validator: core.isNumber,
		value: 5,
		writeOnce: true
	},

	/**
	 * Elements with scroll, besides the document, that contain any of the given
	 * sources. Can be either a single element or a selector for multiple elements.
	 * @type {Element|string}
	 */
	scrollContainers: {
		setter: 'setterScrollContainersFn_',
		validator: 'validateElementOrString_'
	},

	/**
	 * Elements that should be draggable. Can be either a single element
	 * or a selector for multiple elements.
	 * @type {!Element|string}
	 */
	sources: {
		validator: 'validateElementOrString_'
	},

	/**
	 * Flag indicating if a shim should be used for capturing document events.
	 * This is important for allowing dragging nodes over iframes. If false,
	 * events will be listened in the document itself instead.
	 * @type {boolean}
	 * @default true
	 */
	useShim: {
		value: true
	}
};

/**
 * Holds the names of events that can be emitted by `Drag`.
 * @type {!Object}
 * @static
 */
Drag.Events = {
	DRAG: 'drag',
	END: 'end'
};

/**
 * Holds the values that can be passed to the `dragPlaceholder` attribute.
 * @type {!Object}
 * @static
 */
Drag.Placeholder = {
	CLONE: 'clone'
};

export default Drag;
