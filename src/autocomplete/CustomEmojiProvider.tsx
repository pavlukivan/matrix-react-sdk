/*
Copyright 2016 Aviral Dasgupta
Copyright 2017 Vector Creations Ltd
Copyright 2017, 2018 New Vector Ltd
Copyright 2019 The Matrix.org Foundation C.I.C.

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

import React from 'react';
import { _t } from '../languageHandler';
import AutocompleteProvider from './AutocompleteProvider';
import QueryMatcher from './QueryMatcher';
import {PillCompletion} from './Components';
import {ICompletion, ISelectionRange} from './Autocompleter';
import {uniq, sortBy} from 'lodash';
import SettingsStore from "../settings/SettingsStore";
import { EMOJI, IEmoji } from '../emoji';
import { MatrixClientPeg } from '../MatrixClientPeg';

const LIMIT = 20;

// Match for ascii-style ";-)" emoticons or ":wink:" shortcodes provided by emojibase
// anchored to only match from the start of parts otherwise it'll show emoji suggestions whilst typing matrix IDs
const CUSTOM_EMOJI_REGEX = /(\S+)/g;

interface ICustomEmojiShort {
    url: string;
    shortname: string;
    _orderBy: number;
}

function score(query, space) {
    const index = space.indexOf(query);
    if (index === -1) {
        return Infinity;
    } else {
        return index;
    }
}

export default class CustomEmojiProvider extends AutocompleteProvider {
    matcher: QueryMatcher<ICustomEmojiShort>;

    constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({ commandRegex: CUSTOM_EMOJI_REGEX, renderingType });
        let emojis: any = MatrixClientPeg.get().getAccountData('im.ponies.user_emotes');
        if (emojis && emojis.event) emojis = emojis.event;
        if (emojis && emojis.content) {
            emojis = emojis.content;
            if (emojis.emoticons) emojis = emojis.emoticons;
            else if (emojis.images) emojis = emojis.images;
            else emojis = {};
        } else {
            emojis = {};
        }
        let shortnames: ICustomEmojiShort[] = [];
        let i = -1;
        for (let name in emojis) {
            ++i;
            let name2 = name;
            if (!name.startsWith(':')) name2 = ':' + name2 + ':';
            shortnames.push({ url: ''+emojis[name].url, shortname: name2, _orderBy: i });
        }
        this.matcher = new QueryMatcher<ICustomEmojiShort>(shortnames, {
            keys: ['shortname'],
            // For matching against ascii equivalents
            shouldMatchWordsOnly: false,
        });
    }

    async getCompletions(
        query: string,
        selection: ISelectionRange,
        force?: boolean,
        limit = -1,
    ): Promise<ICompletion[]> {
        if (!SettingsStore.getValue("MessageComposerInput.suggestEmoji")) {
            return []; // don't give any suggestions if the user doesn't want them
        }

        let completions = [];
        const { command, range } = this.getCurrentCommand(query, selection);

        if (command) {
            const matchedString = command[0];
            completions = this.matcher.match(matchedString, limit);

            const sorters = [];

            // sort by score (Infinity if matchedString not in shortname)
            sorters.push((c) => score(matchedString, c.shortname));
            // If the matchedString is not empty, sort by length of shortname. Example:
            //  matchedString = ":bookmark"
            //  completions = [":bookmark:", ":bookmark_tabs:", ...]
            if (matchedString.length > 1) {
                sorters.push((c) => c.shortname.length);
            }
            // Finally, sort by original ordering
            sorters.push((c) => c._orderBy);
            completions = sortBy(uniq(completions), sorters);

            completions = completions.map(({url, shortname}) => {
                const markdown = `![${shortname}](emoji-hack-fixme:${url})`;
                return {
                    completion: markdown,
                    component: (
                        <PillCompletion title={shortname} aria-label={markdown}>
                            <span>{ markdown }</span>
                        </PillCompletion>
                    ),
                    range,
                };
            }).slice(0, LIMIT);
        }
        return completions;
    }

    getName() {
        return 'Custom Emoji';
    }

    renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                role="listbox"
                aria-label="Custom Emoji Autocomplete"
            >
                { completions }
            </div>
        );
    }
}
