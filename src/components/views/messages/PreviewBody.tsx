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
import ReactDOM from 'react-dom';
import highlight from 'highlight.js';
import { MsgType } from "matrix-js-sdk/src/@types/event";

import * as HtmlUtils from '../../../HtmlUtils';
import { formatDate } from '../../../DateUtils';
import Modal from '../../../Modal';
import dis from '../../../dispatcher/dispatcher';
import { _t } from '../../../languageHandler';
import * as ContextMenu from '../../structures/ContextMenu';
import { toRightOf } from '../../structures/ContextMenu';
import SettingsStore from "../../../settings/SettingsStore";
import ReplyThread from "../elements/ReplyThread";
import { pillifyLinks, unmountPills } from '../../../utils/pillify';
import { IntegrationManagers } from "../../../integrations/IntegrationManagers";
import { isPermalinkHost } from "../../../utils/permalinks/Permalinks";
import { copyPlaintext } from "../../../utils/strings";
import AccessibleTooltipButton from "../elements/AccessibleTooltipButton";
import { replaceableComponent } from "../../../utils/replaceableComponent";
import UIStore from "../../../stores/UIStore";
import { ComposerInsertPayload } from "../../../dispatcher/payloads/ComposerInsertPayload";
import { Action } from "../../../dispatcher/actions";
import GenericTextContextMenu from "../context_menus/GenericTextContextMenu";
import Spoiler from "../elements/Spoiler";
import QuestionDialog from "../dialogs/QuestionDialog";
import MessageEditHistoryDialog from "../dialogs/MessageEditHistoryDialog";
import EditMessageComposer from '../rooms/EditMessageComposer';
import LinkPreviewGroup from '../rooms/LinkPreviewGroup';
import { IBodyProps } from "./IBodyProps";

interface IState {
    // the URLs (if any) to be previewed with a LinkPreviewWidget inside this TextualBody.
    links: string[];

    // track whether the preview widget is hidden
    widgetHidden: boolean;
}

@replaceableComponent("views.messages.TextualBody")
export default class TextualBody extends React.Component<IBodyProps, IState> {
    private readonly contentRef = createRef<HTMLSpanElement>();

    private unmounted = false;
    private pills: Element[] = [];

    constructor(props) {
        super(props);

        this.state = {
            links: [],
            widgetHidden: false,
        };
    }

    componentDidMount() {
        this.applyFormatting();
    }

    private applyFormatting(): void {
        const showLineNumbers = SettingsStore.getValue("showCodeLineNumbers");

        // pillifyLinks BEFORE linkifyElement because plain room/user URLs in the composer
        // are still sent as plaintext URLs. If these are ever pillified in the composer,
        // we should be pillify them here by doing the linkifying BEFORE the pillifying.
        pillifyLinks([this.contentRef.current], this.props.mxEvent, this.pills);
        HtmlUtils.linkifyElement(this.contentRef.current);

        if (this.props.mxEvent.getContent().format === "org.matrix.custom.html") {
            // Handle expansion and add buttons
            const pres = (ReactDOM.findDOMNode(this) as Element).getElementsByTagName("pre");
            if (pres.length > 0) {
                for (let i = 0; i < pres.length; i++) {
                    // If there already is a div wrapping the codeblock we want to skip this.
                    // This happens after the codeblock was edited.
                    if (pres[i].parentElement.className == "mx_EventTile_pre_container") continue;
                    // Add code element if it's missing since we depend on it
                    if (pres[i].getElementsByTagName("code").length == 0) {
                        this.addCodeElement(pres[i]);
                    }
                    // Wrap a div around <pre> so that the copy button can be correctly positioned
                    // when the <pre> overflows and is scrolled horizontally.
                    const div = this.wrapInDiv(pres[i]);
                    this.handleCodeBlockExpansion(pres[i]);
                    this.addCodeExpansionButton(div, pres[i]);
                    this.addCodeCopyButton(div);
                    if (showLineNumbers) {
                        this.addLineNumbers(pres[i]);
                    }
                }
            }
            // Highlight code
            const codes = (ReactDOM.findDOMNode(this) as Element).getElementsByTagName("code");
            if (codes.length > 0) {
                // Do this asynchronously: parsing code takes time and we don't
                // need to block the DOM update on it.
                setTimeout(() => {
                    if (this.unmounted) return;
                    for (let i = 0; i < codes.length; i++) {
                        // If the code already has the hljs class we want to skip this.
                        // This happens after the codeblock was edited.
                        if (codes[i].className.includes("hljs")) continue;
                        this.highlightCode(codes[i]);
                    }
                }, 10);
            }
        }
    }

    private addCodeElement(pre: HTMLPreElement): void {
        const code = document.createElement("code");
        code.append(...pre.childNodes);
        pre.appendChild(code);
    }

    private addCodeExpansionButton(div: HTMLDivElement, pre: HTMLPreElement): void {
        // Calculate how many percent does the pre element take up.
        // If it's less than 30% we don't add the expansion button.
        // We also round the number as it sometimes can be 29.99...
        const percentageOfViewport = Math.round(pre.offsetHeight / UIStore.instance.windowHeight * 100);
        if (percentageOfViewport < 30) return;

        const button = document.createElement("span");
        button.className = "mx_EventTile_button ";
        if (pre.className == "mx_EventTile_collapsedCodeBlock") {
            button.className += "mx_EventTile_expandButton";
        } else {
            button.className += "mx_EventTile_collapseButton";
        }

        button.onclick = async () => {
            button.className = "mx_EventTile_button ";
            if (pre.className == "mx_EventTile_collapsedCodeBlock") {
                pre.className = "";
                button.className += "mx_EventTile_collapseButton";
            } else {
                pre.className = "mx_EventTile_collapsedCodeBlock";
                button.className += "mx_EventTile_expandButton";
            }

            // By expanding/collapsing we changed
            // the height, therefore we call this
            this.props.onHeightChanged();
        };

        div.appendChild(button);
    }

    private addCodeCopyButton(div: HTMLDivElement): void {
        const button = document.createElement("span");
        button.className = "mx_EventTile_button mx_EventTile_copyButton ";

        // Check if expansion button exists. If so
        // we put the copy button to the bottom
        const expansionButtonExists = div.getElementsByClassName("mx_EventTile_button");
        if (expansionButtonExists.length > 0) button.className += "mx_EventTile_buttonBottom";

        button.onclick = async () => {
            const copyCode = button.parentElement.getElementsByTagName("code")[0];
            const successful = await copyPlaintext(copyCode.textContent);

            const buttonRect = button.getBoundingClientRect();
            const { close } = ContextMenu.createMenu(GenericTextContextMenu, {
                ...toRightOf(buttonRect, 2),
                message: successful ? _t('Copied!') : _t('Failed to copy'),
            });
            button.onmouseleave = close;
        };

        div.appendChild(button);
    }

    private wrapInDiv(pre: HTMLPreElement): HTMLDivElement {
        const div = document.createElement("div");
        div.className = "mx_EventTile_pre_container";

        // Insert containing div in place of <pre> block
        pre.parentNode.replaceChild(div, pre);
        // Append <pre> block and copy button to container
        div.appendChild(pre);

        return div;
    }

    private handleCodeBlockExpansion(pre: HTMLPreElement): void {
        if (!SettingsStore.getValue("expandCodeByDefault")) {
            pre.className = "mx_EventTile_collapsedCodeBlock";
        }
    }

    private addLineNumbers(pre: HTMLPreElement): void {
        // Calculate number of lines in pre
        const number = pre.innerHTML.replace(/\n(<\/code>)?$/, "").split(/\n/).length;
        pre.innerHTML = '<span class="mx_EventTile_lineNumbers"></span>' + pre.innerHTML + '<span></span>';
        const lineNumbers = pre.getElementsByClassName("mx_EventTile_lineNumbers")[0];
        // Iterate through lines starting with 1 (number of the first line is 1)
        for (let i = 1; i <= number; i++) {
            lineNumbers.innerHTML += '<span class="mx_EventTile_lineNumber">' + i + '</span>';
        }
    }

    private highlightCode(code: HTMLElement): void {
        // Auto-detect language only if enabled and only for codeblocks
        if (
            SettingsStore.getValue("enableSyntaxHighlightLanguageDetection") &&
            code.parentElement instanceof HTMLPreElement
        ) {
            highlight.highlightBlock(code);
        } else {
            // Only syntax highlight if there's a class starting with language-
            const classes = code.className.split(/\s+/).filter(function(cl) {
                return cl.startsWith('language-') && !cl.startsWith('language-_');
            });

            if (classes.length != 0) {
                highlight.highlightBlock(code);
            }
        }
    }

    componentDidUpdate(prevProps) {
    }

    componentWillUnmount() {
        this.unmounted = true;
        unmountPills(this.pills);
    }

    shouldComponentUpdate(nextProps, nextState) {
        //console.info("shouldComponentUpdate: ShowUrlPreview for %s is %s", this.props.mxEvent.getId(), this.props.showUrlPreview);

        return (nextProps.mxEvent.getContent() !== this.props.mxEvent.getContent() ||
                nextProps.highlights !== this.props.highlights ||
                nextProps.replacingEventId !== this.props.replacingEventId ||
                nextProps.highlightLink !== this.props.highlightLink ||
                nextProps.showUrlPreview !== this.props.showUrlPreview ||
                nextProps.editState !== this.props.editState ||
                nextState.links !== this.state.links ||
                nextState.widgetHidden !== this.state.widgetHidden);
    }

    public getEventTileOps = () => ({
        isWidgetHidden: () => {
            return this.state.widgetHidden;
        },

        unhideWidget: () => {
            this.setState({ widgetHidden: false });
        },
    });

    render() {
        const mxEvent = this.props.mxEvent;
        const content = mxEvent.getContent();

        // only strip reply if this is the original replying event, edits thereafter do not have the fallback
        const stripReply = !mxEvent.replacingEvent() && !!ReplyThread.getParentEventId(mxEvent);
        let body = HtmlUtils.bodyToHtml(content, this.props.highlights, {
            disableBigEmoji: content.msgtype === MsgType.Emote
                || !SettingsStore.getValue<boolean>('TextualBody.enableBigEmoji'),
            // Part of Replies fallback support
            stripReplyFallback: stripReply,
            ref: this.contentRef,
            returnString: false,
        });

        return (
            <div className="mx_MTextBody mx_EventTile_content">
                { body }
            </div>
        );
    }
}
