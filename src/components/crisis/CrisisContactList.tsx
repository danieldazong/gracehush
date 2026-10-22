import { Fragment } from "react";
import { View } from "react-native";

import { CrisisContactRow } from "@/components/crisis/CrisisContactRow";
import type { CrisisResource } from "@/types";

type CrisisContactListProps = {
  resources: CrisisResource[];
  onPress: (resource: CrisisResource) => void;
  grouped?: boolean;
};

// The contact rows in one white card, with a hairline between them that starts at the text (16 padding, a 40
// tile and a 12 gap, so 68): the grouped-list pattern, instead of a bordered box for every row.
export function CrisisContactList({ resources, onPress, grouped = false }: CrisisContactListProps) {
  return (
    <View className="card overflow-hidden p-0">
      {resources.map((resource, index) => (
        <Fragment key={resource.id}>
          {index > 0 ? <View className="divider ml-[68px]" /> : null}
          <CrisisContactRow resource={resource} grouped={grouped} onPress={() => onPress(resource)} />
        </Fragment>
      ))}
    </View>
  );
}
