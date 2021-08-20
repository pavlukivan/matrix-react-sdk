/*
Copyright 2015 - 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { createRef, SyntheticEvent } from 'react';

import * as HtmlUtils from '../../../HtmlUtils';
import SettingsStore from "../../../settings/SettingsStore";
import { replaceableComponent } from "../../../utils/replaceableComponent";
import { IBodyProps } from "./IBodyProps";

interface IState {
}

@replaceableComponent("views.messages.PreviewBody")
export default class PreviewBody extends React.Component<IBodyProps, IState> {
    private readonly contentRef = createRef<HTMLSpanElement>();

    constructor(props) {
        super(props);

        this.state = {};
    }

    shouldComponentUpdate(nextProps, nextState) {
        //console.info("shouldComponentUpdate: ShowUrlPreview for %s is %s", this.props.mxEvent.getId(), this.props.showUrlPreview);

        return (nextProps.mxEvent.getContent() !== this.props.mxEvent.getContent() ||
                nextProps.highlights !== this.props.highlights ||
                nextProps.replacingEventId !== this.props.replacingEventId ||
                nextProps.highlightLink !== this.props.highlightLink ||
                nextProps.showUrlPreview !== this.props.showUrlPreview ||
                nextProps.editState !== this.props.editState);
    }

    render() {
        const mxEvent = this.props.mxEvent;
        const content = mxEvent.getContent();

        let body: any = HtmlUtils.bodyToHtml(content, this.props.highlights, {
            disableBigEmoji: !SettingsStore.getValue<boolean>('TextualBody.enableBigEmoji'),
            stripReplyFallback: false,
            ref: this.contentRef,
            returnString: false,
        });
        if (body && body.props && body.props.children === content.body) return null;

        return (
            <div className="mx_MTextBody mx_EventTile_content">
                <p><strong>Preview:</strong></p>
                { body }
            </div>
        );
    }
}
