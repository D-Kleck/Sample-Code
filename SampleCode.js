
'use strict';

export function SubclipFormDirective() {
    'ngInject';

    return {
        restrict: 'E',
        link,
        template: template,
        replace: 'true',
        scope: {
            control: '=',
            numvideoitems: '=',
            numaudioitems: '='
        },
        controller: SubclipFormDirectiveController,
        controllerAs: 'vm',
        bindToController: 'true'
    };

    function link(scope, element, attrs, vm) {

        // Allows an API on the directive.
        scope.api = scope.control || {};

        /**
         * Initialise the subclip form.
         *
         * @param {Object} clip Subclip to edit. Null if creating new.
         * @param {number} inPoint In point frame.
         * @param {number} outPoint Out point frame.
         * @param {Array} sortedVideoComponents Sorted array of video components
         * @param {Array} sortedAudioComponents Sorted array of audio components
         */
        scope.api.initialise = (clip, inPoint, outPoint, sortedVideoComponents, sortedAudioComponents) => {
            vm.initialise(clip, inPoint, outPoint, sortedVideoComponents, sortedAudioComponents);
        };

        scope.api.initializeFromMarkers = (markers, sortedVideoComponents, sortedAudioComponents) => {
            vm.initializeFromMarkers(markers, sortedVideoComponents, sortedAudioComponents);
        };
    }
}

class SubclipFormDirectiveController {

    constructor($log, $scope, $timeout, $window, $rootScope, toastr,
        ItemStorageService, SubclipStorageService, FormService, FrameService, SubclipService, ItemService, FeatureToggleService,
        SettingsService, DialogBoxService, PlaybackService, componentNameFilter, languageFilter) {
        'ngInject';

        this.$log = $log;
        this.$scope = $scope;
        this.$timeout = $timeout;
        this.$window = $window;
        this.$rootScope = $rootScope;
        this.toastr = toastr;

        this.ItemStorageService = ItemStorageService;
        this.SubclipStorageService = SubclipStorageService;
        this.FormService = FormService;
        this.FrameService = FrameService;
        this.SubclipService = SubclipService;
        this.ItemService = ItemService;
        this.FeatureToggleService = FeatureToggleService;
        this.SettingsService = SettingsService;
        this.DialogBoxService = DialogBoxService;
        this.PlaybackService = PlaybackService;

        this.componentNameFilter = componentNameFilter;
        this.languageFilter = languageFilter;

        this.numVideoItems = $scope.numvideoitems;
        this.numAudioItems = $scope.numaudioitems;

        this.discreteSubclipsEnabled = this.FeatureToggleService.getConstant(FeatureToggle.DISCRETE_SUBCLIPS);
        this.subclipAudioExportShape = this.SettingsService.getSetting(Settings.SUBCLIP_AUDIO_EXPORT_SHAPE);

        this.audioComponents = ItemStorageService.audioComponents;

        this.markers = [];

        // Update current in point when marking in
        $rootScope.$on(MarkEvent.IN_SET, (event, inPoint) => {
            this.startInput = this.FrameService.formatFrame(inPoint);
        });

        // Update current out point when marking out
        $rootScope.$on(MarkEvent.OUT_SET, (event, outPoint) => {
            this.endInput = this.FrameService.formatFrame(outPoint);
        });

    }

    /**
     * Initalise subclip form.
     *
     * @param {Object} clip Subclip to edit. Null if new.
     * @param {number} inPoint In point, in frame.
     * @param {number} outPoint Out point, in frame.
     * @param {Object} sortedVideoComponents Sorted array of video components
     * @param {Object} sortedAudioComponents Sorted array of audio components
     */
    initialise(clip, inPoint, outPoint, sortedVideoComponents, sortedAudioComponents) {
        this.$log.debug('Initializing subclip form');

        this.markers = [];
        this.clip = clip;
        this.focus = true;
        this.shapeSelected = false;
        this.editing = (this.clip !== null);

        this.sortedVideoComponents = sortedVideoComponents;
        this.sortedAudioComponents = sortedAudioComponents;

        // Keep selection data separated from actual components.
        this.discreteAudio = this.getDiscreteAudioSelections(clip);

        this.loadVideo(clip);

        if (!clip) {
            this.clip = {
                name: ''
            };

            // Use marked in-point and out-point if they are set
            this.startInput = this.FrameService.formatFrame(inPoint);
            this.endInput = this.FrameService.formatFrame(outPoint);
            return;
        }

        this.startInput = this.FrameService.formatFrame(clip.start);
        this.endInput = this.FrameService.formatFrame(clip.end);

        // Clear in-point and out-point if set
        this.PlaybackService.clearPointsIfSet();
        // Set in-point and out-point
        this.PlaybackService.markInPoint(clip.start);
        this.PlaybackService.markOutPoint(clip.end);

    }

    initializeFromMarkers(markers, sortedVideoComponents, sortedAudioComponents) {
        this.clip = null;
        this.sortedAudioComponents = sortedAudioComponents;
        this.sortedVideoComponents = sortedVideoComponents;
        this.discreteAudio = this.getDiscreteAudioSelections(null);
        this.loadVideo(null);
        this.markers = markers;
        this.clip = {};
    }

    /**
     * Load video intially
     *
     * @param {Object|null} clip Subclip to edit. Null if new
     */
    loadVideo(clip) {
        if (!clip) {
            for (const component of this.ItemStorageService.videoComponents) {
                if (component.shapeTag === ORIGINAL_SHAPE_TAG) {
                    this.onVideoSelect(component);
                    return;
                }
            }
            // Did not find original shape.
            this.onVideoSelect(this.ItemStorageService.currentVideoComponent);
            return;
        }

        // Find video based on id stored in clip
        const video = this.ItemStorageService.videoComponents.find((component) => {
            return component.id === clip.videoId;
        });
        this.onVideoSelect(video);
    }

    /**
     * Loads muxed audio.
     *
     */
    loadMuxedAudio() {
        this.muxedAudio = this.getMuxedAudioSelections(this.clip);
    }

    /**
     * Number of Video items.
     *
     * @return {number} count Number of Video items.
     */
    numVideoItems() {
        let count = 0;
        for (const key in this.sortedVideoComponents) {
            if (this.sortedVideoComponents.hasOwnProperty(key)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Returns a hash with discrete audio components and their 'selected' status
     * This is used to avoid changing selected status globally.
     *
     * @param {Object} clip Subclip being edited.
     * @return {Object} Hash with discrete track id -> status object.
     */
    getDiscreteAudioSelections(clip) {
        const discreteAudio = {};

        if (!this.subclipAudioExportShape) {
            return discreteAudio;
        }

        if (clip) {
            this.ItemStorageService.audioComponents.forEach((component) => {
                discreteAudio[component.id] = {
                    'component': component,
                    'selected': this._hasDiscreteAudio(clip, component)
                };
            });
        }
        else {
            this.ItemStorageService.audioComponents.forEach((component) => {
                discreteAudio[component.id] = {
                    'component': component,
                    'selected': false
                };
            });
        }

        return discreteAudio;
    }

    /**
     * Returns a hash with muxed audio components and theid 'selected' status.
     * This is used to avoid changing selected status globally.
     *
     * @param {Object} clip Subclip being edited.
     * @return {Object} Hash with muxed component id -> status object.
     */
    getMuxedAudioSelections(clip) {
        const muxedAudio = {};
        if (!this.audioTracks) {
            return muxedAudio;
        }

        if (clip) {
            this.audioTracks.forEach((component) => {
                muxedAudio[component.id] = {
                    'component': component,
                    'selected': this._hasMuxedAudio(clip, component)
                };
            });
        }
        else {
            this.audioTracks.forEach((component) => {
                muxedAudio[component.id] = {
                    'component': component,
                    'selected': true
                };
            });
        }

        return muxedAudio;
    }

    /**
     * Checks if the component is present in the subclip.
     *
     * @param {Object} clip The subclip.
     * @param {Object} component The component.
     * @return {boolean} True/false
     * @private
     */
    _hasDiscreteAudio(clip, component) {
        if (!clip.discreteAudio) {
            return false;
        }

        return Object.keys(clip.discreteAudio).includes(component.id);
    }

    /**
     * Checks if the component is present in the subclip.
     *
     * @param {Object} clip The subclip.
     * @param {Object} component The component to look for.
     * @return {boolean} True/false
     * @private
     */
    _hasMuxedAudio(clip, component) {
        if (!clip.audioTracks || clip.audioTracks.length === 0) {
            return false;
        }

        // Look for the component among the audio track containers in the subclip
        return clip.audioTracks.some((audioTrackContainer) => {
            return component.id === audioTrackContainer.audioTrack.id;
        });
    }

    /**
     * Formats a label for external audio tracks display.
     *
     * @return {string} External audio display label.
     */
    showExternalAudioLabel() {

        if (!this.discreteAudio) {
            return '';
        }
        const selected = Object.keys(this.discreteAudio).filter((id) => {
            return this.discreteAudio[id].selected;
        });

        if (!selected.length) {
            return 'No audio tracks selected';
        }

        if (selected.length > 3) {
            return `${selected.length} selected`;
        }

        return selected.map((id) => {
            const component = this.discreteAudio[id].component;
            return `${this.componentNameFilter(component)} ${this.languageFilter(component.language)} (${component.shapeTag})`;
        }).join(', ');

    }

    /**
     * Formats a label for muxed audio tracks display.
     *
     * @return {string} Muxed audio display label.
     */
    showMuxedAudioLabel() {
        if (!this.muxedAudio) {
            return '';
        }
        const selected = Object.keys(this.muxedAudio).filter((id) => this.muxedAudio[id].selected);

        if (!selected.length) {
            return 'No audio tracks selected';
        }

        if (selected.length > 3) {
            return `${selected.length} selected`;
        }

        return selected.map((id) => {
            const component = this.muxedAudio[id].component;
            return `${this.componentNameFilter(component)} ${this.languageFilter(component.language)}`;

        }).join(', ');
    }

    /**
     * Returns all muxed audio components that are selected
     *
     * @return {Array} Array containing all selected muxed audio components
     * @private
     */
    _getSelectedMuxedAudioComponents() {

        return Object.keys(this.muxedAudio)
            .filter((id) => this.muxedAudio[id].selected)
            .map((id) => this.muxedAudio[id].component);

    }

    /**
     * Resets the form. Call after submitting.
     */
    resetClipForm() {
        this.FormService.resetForm(this.$scope.form, this.$scope);

        // Clear in-point and out-point
        this.PlaybackService.clearPoints();
    }

    /**
     * Returns a hash Object containing all selected discrete audio components.
     * Keys is component id, value is the component.
     *
     * @return {Object} Object with all selected discrete audio components
     * @private
     */
    _getSelectedAudioComponents() {
        const selected = {};

        Object.keys(this.discreteAudio).forEach((id) => {
            const audio = this.discreteAudio[id];

            if (audio.selected) {
                selected[id] = audio.component;
            }
        });

        return selected;
    }

    submit() {
        const clips = [];
        if (this.markers.length) {
            this.markers.forEach((marker) => {
                this.startInput = this.FrameService.formatFrame(marker.start);
                this.endInput = this.FrameService.formatFrame(marker.end);
                this.clip.name = marker.name;
                this._submit();
                this.SubclipStorageService.add(this.clip);
                clips.push(this.clip);
                this.clip = {};
            });
            this.markers = [];
        }
        else {
            this._submit();
            if (this.editing) {
                return;
            }
            this.SubclipStorageService.add(this.clip);
        }
        if (this.markers.length) {
            this.toastr.success('Subclip created');
        }
        else {
            this.toastr.success('Subclips created');
        }

        // Trigger reload in subclip table send the new clips for direct export in bulk mode.
        this.$scope.$emit(SubclipEvent.SAVED, clips.length > 1 ? clips : []);
    }

    /**
     * Called when the form is submitted.
     */
    _submit() {

        const startFrame = this.FrameService.getStartFrame(this.startInput);
        const endFrame = this.FrameService.getEndFrame(this.endInput, startFrame);

        if (endFrame < startFrame) {
            this.toastr.error('Invalid end frame');
            return;
        }

        this.clip.start = startFrame;
        this.clip.end = endFrame;

        // Frames start at 0, so one frame must be added
        this.clip.duration = Number(endFrame - startFrame) + 1;

        // Create clips for all active discrete tracks
        const selectedAudioComponents = this._getSelectedAudioComponents();
        if (this.discreteSubclipsEnabled && Object.keys(selectedAudioComponents).length) {
            this.clip.discreteAudio = selectedAudioComponents;
        }
        else {
            delete this.clip.discreteAudio;
        }

        this.clip.shape = this.selectedVideo.shapeTag;
        this.clip.itemId = this.selectedVideo.itemId; // Store item id per clip
        this.clip.videoId = this.selectedVideo.id;

        const selectedMuxedAudioComponents = this._getSelectedMuxedAudioComponents();

        if (selectedMuxedAudioComponents && selectedMuxedAudioComponents.length) {
            this.clip.audioTracks = selectedMuxedAudioComponents.map((audioTrack) => {
                return this.SubclipService.setAudioTrack({audioTrack: audioTrack}, audioTrack, this.audioTracks);
            });
        }
        else {
            delete this.clip.audioTracks;
        }

        this.$log.debug('Saving clip', this.clip);

        const name = this.clip.name;
        const duration = this.clip.duration;

        // Update or create new subclip?
        if (this.editing) {
            this.update(name, startFrame, endFrame, duration);
            return;
        }
    }

    /**
     * Called when deleting the current subclip.
     */
    onDelete() {
        const id = this.clip.id;

        if (!id) {
            this.$log.error('No id of subclip set - cannot delete');
            return;
        }

        this.DialogBoxService.showDeleteDialog(
            'Delete subclip',
            `Subclip '${this.clip.name}' will be deleted. This action cannot be undone.`)
            .then(() => {
                this.SubclipStorageService.remove(id);
                this.toastr.success('Subclip deleted');
                this.cancel();

                // Trigger reload in subclip table
                this.$scope.$emit(SubclipEvent.SAVED, []);
            });
    }

    /**
     * Called when a video is selected
     *
     * @param {Object} video The selected video
     */
    onVideoSelect(video) {
        this.$log.debug("Video selected", video);
        this._setVideo(video);

        this.loadMuxedAudio();

    }

    /**
     * Sets the current video and its internal audio.
     *
     * @param {Object} video Video component to set
     * @private
     */
    _setVideo(video) {
        this.selectedVideo = video;
        this.audioTracks = video.audio;
    }

    /**
     * Called when intenal audio component is selected.
     *
     * @param {Object} component Audio component
     * @param {number} index Track index
     */
    onAudioSelect(component) {
        const audio = this.muxedAudio[component.id];
        audio.selected = !audio.selected;
    }

    /**
     * Called when an external audio component is selected.
     *
     * @param {Object} component Selected component
     */
    onExternalAudioSelect(component) {
        const audio = this.discreteAudio[component.id];
        audio.selected = !audio.selected;
    }

    /**
     * Updates a subclip for a given item.
     *
     * @param {string} name Name of clip.
     * @param {number} startFrame Start frame.
     * @param {number} endFrame End frame.
     * @param {number} duration Duration of clip.
     */
    update(name, startFrame, endFrame, duration) {
        // Make a copy of clip being saved
        const savedClip = Object.assign({}, this.clip);
        savedClip.name = name;
        savedClip.start = startFrame;
        savedClip.end = endFrame;
        savedClip.duration = duration;

        this.SubclipStorageService.update(savedClip);
        this.toastr.success('Subclip updated');

        // Trigger reload in subclip table
        this.$scope.$emit(SubclipEvent.SAVED, []);
    }

    /**
     * Called when cancelling the subclip form.
     */
    cancel() {
        this.resetClipForm();
        this.focus = false;
        this.$scope.$emit(PlayerEvent.SHOW_SETTINGS);
    }

}